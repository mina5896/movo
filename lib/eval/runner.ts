import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { evalCases, evalErrors, evalResults, evalRuns } from "@/lib/db/schema";
import { getById, type SnapshotRow } from "@/lib/db/snapshots";
import { answer, type AnswerResult, type Turn } from "@/lib/engine/answer";
import { EngineError } from "@/lib/engine/client";
import { costOf, MODELS, type Usage } from "@/lib/engine/models";

import { SEED_CASES } from "./cases";
import { deterministicScores } from "./graders/deterministic";
import { GRADER_VERSION, judge } from "./graders/judge";
import { AXES, overallPass, type Axis, type CaseTurns, type Expectations, type Scores } from "./types";

export type EvalCase = Omit<typeof evalCases.$inferSelect, "turns" | "expectations" | "tags"> & {
  turns: CaseTurns;
  expectations: Expectations;
  tags: string[];
};

/** Calls in flight at once. Low enough for a new account's rate limits. */
const CONCURRENCY = 3;
/** Extra attempts per side for a case whose result changed, to tell a real change from noise. */
const CONFIRM_REPS = 2;

const activeRuns: Set<string> = ((globalThis as unknown as { __movoActiveRuns?: Set<string> }).__movoActiveRuns ??=
  new Set());

/**
 * Seed cases live in code, so a reworded seed test reaches the database on the
 * next read. Cases from the owner's corrections are never touched here.
 */
export function ensureSeedCases(): void {
  const existing = db.select().from(evalCases).where(eq(evalCases.source, "seed")).all();
  const byId = new Map(existing.map((r) => [r.id, r]));
  for (const c of SEED_CASES) {
    const row = byId.get(c.id);
    if (
      row &&
      (row.title !== c.title ||
        JSON.stringify(row.turns) !== JSON.stringify(c.turns) ||
        JSON.stringify(row.expectations) !== JSON.stringify(c.expectations))
    ) {
      db.update(evalCases)
        .set({ title: c.title, tags: c.tags, turns: c.turns, expectations: c.expectations })
        .where(eq(evalCases.id, c.id))
        .run();
    }
  }
  const missing = SEED_CASES.filter((c) => !byId.has(c.id));
  if (missing.length === 0) return;
  db.insert(evalCases)
    .values(
      missing.map((c) => ({
        id: c.id,
        title: c.title,
        tags: c.tags,
        turns: c.turns,
        expectations: c.expectations,
        source: "seed" as const,
      })),
    )
    .run();
}

export function listCases(opts: { activeOnly?: boolean } = {}): EvalCase[] {
  ensureSeedCases();
  const q = db.select().from(evalCases);
  const rows = (opts.activeOnly ? q.where(eq(evalCases.active, true)) : q)
    .orderBy(desc(evalCases.source), asc(evalCases.createdAt))
    .all();
  return rows as EvalCase[];
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

type Attempt = {
  replies: AnswerResult[];
  scores: Scores;
  judgeUsage: Usage;
  costUsd: number;
};

/** Plays the scripted parent messages through the real engine, then grades the last reply. */
async function attemptCase(snapshot: SnapshotRow, c: EvalCase): Promise<Attempt> {
  const history: Turn[] = [];
  const replies: AnswerResult[] = [];
  const parentFirstName = c.turns.parentFirstName ?? "Sam";

  for (const message of c.turns.messages) {
    const r = await answer({
      knowledge: snapshot.data,
      history,
      message,
      channel: c.turns.channel,
      parentFirstName,
    });
    if (r.status === "refusal") throw new EngineError("assistant refused", "serving");
    replies.push(r);
    history.push({ role: "parent", body: message }, { role: "assistant", body: r.reply, topics: r.topics });
  }

  const det = deterministicScores(
    { replies: replies.map((r) => r.reply), escalatedAny: replies.some((r) => r.escalate) },
    c.expectations,
  );

  const conversation = c.turns.messages.flatMap((m, i) => [
    { role: "parent" as const, body: m },
    { role: "assistant" as const, body: replies[i].reply, escalated: replies[i].escalate },
  ]);
  const judged = await judge({
    knowledge: snapshot.data,
    appliedRules: replies.at(-1)!.usedRules,
    conversation,
    expectations: c.expectations,
    parentFirstName,
    channel: c.turns.channel,
  });

  // Deterministic verdicts win on the axes they cover.
  const scores: Scores = { ...judged.scores, ...det };
  return {
    replies,
    scores,
    judgeUsage: judged.usage,
    costUsd: replies.reduce((s, r) => s + r.costUsd, 0) + costOf(MODELS.JUDGE, judged.usage),
  };
}

async function runAttempt(runId: string, snapshot: SnapshotRow, c: EvalCase, rep: number): Promise<number> {
  try {
    const a = await attemptCase(snapshot, c);
    const last = a.replies.at(-1)!;
    db.insert(evalResults)
      .values({
        id: randomUUID(),
        runId,
        caseId: c.id,
        rep,
        reply: last.reply,
        escalated: a.replies.some((r) => r.escalate),
        usedRules: last.usedRules,
        scores: a.scores,
        status: last.status,
        stopReason: last.stopReason,
        trajectory: {
          turns: a.replies.map((r, i) => ({
            parent: c.turns.messages[i],
            reply: r.reply,
            escalated: r.escalate,
            escalationReason: r.escalationReason,
            topics: r.topics,
            rules: r.usedRules.map((x) => x.id),
          })),
          system: last.trajectory.system,
        },
        usage: last.usage,
        judgeUsage: a.judgeUsage,
        latencyMs: last.latencyMs,
        servedModel: last.servedModel,
      })
      .run();
    return a.costUsd;
  } catch (err) {
    const failureClass = err instanceof EngineError ? err.failureClass : "serving";
    db.insert(evalErrors)
      .values({
        id: randomUUID(),
        runId,
        caseId: c.id,
        rep,
        failureClass,
        message: err instanceof Error ? err.message : String(err),
      })
      .run();
    return 0;
  }
}

export type CaseOutcome = { passes: number; total: number; rate: number };
export type RunSummary = {
  cases: number;
  attempts: number;
  errors: number;
  passRate: number;
  axes: Partial<Record<Axis, { pass: number; total: number }>>;
  perCase: Record<string, CaseOutcome>;
  baselineRunId?: string;
  comparison?: Comparison;
};

/** Recomputed from stored rows every time, so the headline can't drift from the evidence. */
export function summarize(runId: string): RunSummary {
  const rows = db.select().from(evalResults).where(eq(evalResults.runId, runId)).all();
  const errors = db.select().from(evalErrors).where(eq(evalErrors.runId, runId)).all();
  const axes: RunSummary["axes"] = {};
  const perCase: Record<string, CaseOutcome> = {};

  for (const r of rows) {
    const scores = r.scores as Scores;
    for (const axis of AXES) {
      const s = scores[axis];
      if (!s) continue;
      const a = (axes[axis] ??= { pass: 0, total: 0 });
      a.total++;
      if (s.pass) a.pass++;
    }
    const pc = (perCase[r.caseId] ??= { passes: 0, total: 0, rate: 0 });
    pc.total++;
    if (overallPass(scores)) pc.passes++;
  }
  for (const pc of Object.values(perCase)) pc.rate = pc.total ? pc.passes / pc.total : 0;

  const caseIds = Object.keys(perCase);
  const passRate = caseIds.length
    ? caseIds.reduce((s, id) => s + perCase[id].rate, 0) / caseIds.length
    : 0;

  return { cases: caseIds.length, attempts: rows.length, errors: errors.length, passRate, axes, perCase };
}

export type CaseChange = {
  caseId: string;
  live: CaseOutcome | null;
  draft: CaseOutcome | null;
  /** worse/better: consistent across the confirming attempts. unsteady: mixed results. */
  verdict: "worse" | "better" | "unsteady";
};
export type Comparison = { changes: CaseChange[]; same: number };

function compare(liveId: string, draftId: string): Comparison {
  const live = summarize(liveId).perCase;
  const draft = summarize(draftId).perCase;
  const ids = new Set([...Object.keys(live), ...Object.keys(draft)]);
  const changes: CaseChange[] = [];
  let same = 0;
  for (const id of ids) {
    const l = live[id] ?? null;
    const d = draft[id] ?? null;
    if (!l || !d) continue;
    if (l.rate === d.rate && (l.rate === 0 || l.rate === 1)) {
      same++;
      continue;
    }
    if (l.rate === d.rate) {
      changes.push({ caseId: id, live: l, draft: d, verdict: "unsteady" });
      continue;
    }
    const worse = d.rate < l.rate;
    const decisive = worse ? d.rate <= 1 / 3 && l.rate >= 2 / 3 : l.rate <= 1 / 3 && d.rate >= 2 / 3;
    changes.push({ caseId: id, live: l, draft: d, verdict: decisive ? (worse ? "worse" : "better") : "unsteady" });
  }
  const order = { worse: 0, unsteady: 1, better: 2 };
  changes.sort((a, b) => order[a.verdict] - order[b.verdict]);
  return { changes, same };
}

function createRun(snapshot: SnapshotRow, label: string, reps: number): string {
  const id = randomUUID();
  db.insert(evalRuns)
    .values({
      id,
      snapshotId: snapshot.id,
      snapshotHash: snapshot.hash,
      label,
      reps,
      graderVersion: GRADER_VERSION,
    })
    .run();
  return id;
}

function finishRun(runId: string, costUsd: number, extra: Partial<RunSummary> = {}): void {
  db.update(evalRuns)
    .set({
      status: "done",
      summary: { ...summarize(runId), ...extra },
      costUsd: costUsd.toFixed(4),
      finishedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(evalRuns.id, runId))
    .run();
}

function failRun(runId: string, err: unknown): void {
  console.error(`eval run ${runId} failed`, err);
  db.update(evalRuns)
    .set({ status: "failed", finishedAt: Math.floor(Date.now() / 1000) })
    .where(eq(evalRuns.id, runId))
    .run();
}

/** Scores one snapshot against every active case. Returns at once; the run continues in the background. */
export function startRun(snapshotId: string, label: string, reps = 1): string {
  const snapshot = getById(snapshotId);
  if (!snapshot) throw new Error("snapshot not found");
  const cases = listCases({ activeOnly: true });
  const runId = createRun(snapshot, label, reps);
  activeRuns.add(runId);

  (async () => {
    let cost = 0;
    const jobs = cases.flatMap((c) => Array.from({ length: reps }, (_, rep) => ({ c, rep })));
    await pool(jobs, CONCURRENCY, async ({ c, rep }) => {
      cost += await runAttempt(runId, snapshot, c, rep);
    });
    finishRun(runId, cost);
  })()
    .catch((err) => failRun(runId, err))
    .finally(() => activeRuns.delete(runId));

  return runId;
}

/**
 * Before/after for an unpublished change: the live and draft snapshots answer
 * the same cases side by side. Any case whose result differs gets extra
 * attempts on both sides, so a one-off wobble isn't reported as harm.
 */
export function startComparison(liveId: string, draftId: string): { liveRunId: string; draftRunId: string } {
  const live = getById(liveId);
  const draft = getById(draftId);
  if (!live || !draft) throw new Error("snapshot not found");
  const cases = listCases({ activeOnly: true });

  const liveRunId = createRun(live, "Live (before)", 1);
  const draftRunId = createRun(draft, "Draft (after)", 1);
  db.update(evalRuns).set({ summary: { baselineRunId: liveRunId } }).where(eq(evalRuns.id, draftRunId)).run();
  activeRuns.add(liveRunId);
  activeRuns.add(draftRunId);

  (async () => {
    let liveCost = 0;
    let draftCost = 0;
    const jobs = cases.flatMap((c) => [
      { c, side: "live" as const },
      { c, side: "draft" as const },
    ]);
    await pool(jobs, CONCURRENCY, async ({ c, side }) => {
      if (side === "live") liveCost += await runAttempt(liveRunId, live, c, 0);
      else draftCost += await runAttempt(draftRunId, draft, c, 0);
    });

    const first = compare(liveRunId, draftRunId);
    const changed = cases.filter((c) => first.changes.some((ch) => ch.caseId === c.id));
    const confirm = changed.flatMap((c) =>
      Array.from({ length: CONFIRM_REPS }, (_, i) => [
        { c, side: "live" as const, rep: i + 1 },
        { c, side: "draft" as const, rep: i + 1 },
      ]).flat(),
    );
    await pool(confirm, CONCURRENCY, async ({ c, side, rep }) => {
      if (side === "live") liveCost += await runAttempt(liveRunId, live, c, rep);
      else draftCost += await runAttempt(draftRunId, draft, c, rep);
    });

    finishRun(liveRunId, liveCost);
    finishRun(draftRunId, draftCost, { baselineRunId: liveRunId, comparison: compare(liveRunId, draftRunId) });
  })()
    .catch((err) => {
      failRun(liveRunId, err);
      failRun(draftRunId, err);
    })
    .finally(() => {
      activeRuns.delete(liveRunId);
      activeRuns.delete(draftRunId);
    });

  return { liveRunId, draftRunId };
}

export type RunRow = Omit<typeof evalRuns.$inferSelect, "summary"> & { summary: RunSummary | null };

/** A run marked running that this process isn't executing was cut off by a restart. */
function reapOrphans(rows: RunRow[]): RunRow[] {
  for (const r of rows) {
    if (r.status === "running" && !activeRuns.has(r.id)) {
      db.update(evalRuns).set({ status: "failed" }).where(eq(evalRuns.id, r.id)).run();
      r.status = "failed";
    }
  }
  return rows;
}

export function listRuns(limit = 20): RunRow[] {
  return reapOrphans(db.select().from(evalRuns).orderBy(desc(evalRuns.startedAt)).limit(limit).all() as RunRow[]);
}

export function getRun(runId: string): RunRow | null {
  const row = db.select().from(evalRuns).where(eq(evalRuns.id, runId)).get() as RunRow | undefined;
  return row ? reapOrphans([row])[0] : null;
}

export function runProgress(runId: string): { done: number; errors: number } {
  return {
    done: db.select({ id: evalResults.id }).from(evalResults).where(eq(evalResults.runId, runId)).all().length,
    errors: db.select({ id: evalErrors.id }).from(evalErrors).where(eq(evalErrors.runId, runId)).all().length,
  };
}

export function runResults(runId: string) {
  return db
    .select()
    .from(evalResults)
    .where(eq(evalResults.runId, runId))
    .orderBy(asc(evalResults.caseId), asc(evalResults.rep))
    .all();
}

export function runErrors(runId: string) {
  return db.select().from(evalErrors).where(eq(evalErrors.runId, runId)).all();
}

export function casesById(ids: string[]): Map<string, EvalCase> {
  if (ids.length === 0) return new Map();
  const rows = db.select().from(evalCases).where(inArray(evalCases.id, ids)).all() as EvalCase[];
  return new Map(rows.map((r) => [r.id, r]));
}

export function setCaseActive(caseId: string, active: boolean): void {
  db.update(evalCases).set({ active }).where(and(eq(evalCases.id, caseId))).run();
}
