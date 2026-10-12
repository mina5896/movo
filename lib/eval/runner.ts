import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { evalCases, evalErrors, evalResults, evalRuns } from "@/lib/db/schema";
import { getById, type SnapshotRow } from "@/lib/db/snapshots";
import { answer, type AnswerResult, type Turn } from "@/lib/engine/answer";
import { EngineError } from "@/lib/engine/client";
import { costOf, MODELS, type Usage } from "@/lib/engine/models";
import type { Topic } from "@/lib/engine/snapshot";

import { SEED_CASES } from "./cases";
import type { GeneratedCase } from "./generate";
import SIMULATED from "./simulated-cases.json";
import { deterministicScores } from "./graders/deterministic";
import { GRADER_VERSION, judge } from "./graders/judge";
import { changeReaches } from "./reach";
import { verdict, type CaseChange, type CaseOutcome } from "./verdict";
import { AXES, overallPass, type Axis, type CaseTurns, type Expectations, type Scores } from "./types";

export type EvalCase = Omit<typeof evalCases.$inferSelect, "turns" | "expectations" | "tags"> & {
  turns: CaseTurns;
  expectations: Expectations;
  tags: string[];
};

/** Calls in flight at once. Low enough for a new account's rate limits. */
const CONCURRENCY = 5;
/** Extra attempts per side for a case whose result changed, to tell a real change from noise. */
const CONFIRM_REPS = 2;

const activeRuns: Set<string> = ((globalThis as unknown as { __movoActiveRuns?: Set<string> }).__movoActiveRuns ??=
  new Set());

/**
 * The starting tests live in code: the hand-written seed set, and the tests a
 * simulated parent wrote (lib/eval/simulated-cases.json, see generate.ts). A
 * reworded one reaches the database on the next read. Tests from the owner's
 * corrections or requests are never touched here.
 */
const CODE_CASES = [
  ...SEED_CASES.map((c) => ({ ...c, source: "seed" as const })),
  ...(SIMULATED as GeneratedCase[]).map((c) => ({ ...c, source: "generated" as const })),
];

export function ensureSeedCases(): void {
  const ids = CODE_CASES.map((c) => c.id);
  const byId = new Map(db.select().from(evalCases).where(inArray(evalCases.id, ids)).all().map((r) => [r.id, r]));
  for (const c of CODE_CASES) {
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
  const missing = CODE_CASES.filter((c) => !byId.has(c.id));
  if (missing.length === 0) return;
  db.insert(evalCases)
    .values(
      missing.map((c) => ({
        id: c.id,
        title: c.title,
        tags: c.tags,
        turns: c.turns,
        expectations: c.expectations,
        source: c.source,
      })),
    )
    .run();
}

/** Tests in the set. Tests the owner asked for but hasn't kept yet are left out unless `pending` is set. */
export function listCases(opts: { activeOnly?: boolean; pending?: boolean } = {}): EvalCase[] {
  ensureSeedCases();
  const q = db.select().from(evalCases);
  const pending = eq(evalCases.pending, opts.pending ?? false);
  const rows = (opts.activeOnly ? q.where(and(eq(evalCases.active, true), pending)) : q.where(pending))
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
  const now = c.turns.now ? new Date(c.turns.now) : new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const notices = (c.turns.notices ?? []).map((n) => ({
    text: n.text,
    createdAt: nowSec - Math.round((n.postedHoursAgo ?? 1) * 3600),
    expiresAt: nowSec + 86_400,
  }));

  for (const message of c.turns.messages) {
    const r = await answer({
      knowledge: snapshot.data,
      history,
      message,
      channel: c.turns.channel,
      parentFirstName,
      now,
      notices,
    });
    if (r.status === "refusal") throw new EngineError("assistant refused", "serving");
    replies.push(r);
    history.push({ role: "parent", body: message }, { role: "assistant", body: r.reply, topics: r.topics });
  }

  const det = deterministicScores(
    {
      replies: replies.map((r) => r.reply),
      escalatedAny: replies.some((r) => r.escalate),
      unsupported: replies.at(-1)!.grounding.unsupported,
    },
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
    context: replies.at(-1)!.context,
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
            grounding: r.grounding,
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

export type { CaseChange, CaseOutcome };
/** `notReached`: tests the change couldn't affect, so they weren't replayed. */
export type Comparison = { changes: CaseChange[]; same: number; notReached?: number };

/** The topics of every turn each attempt at a case took, on one run. */
function turnTopics(runId: string): Map<string, Topic[][]> {
  const out = new Map<string, Topic[][]>();
  for (const r of db.select().from(evalResults).where(eq(evalResults.runId, runId)).all()) {
    const turns = (r.trajectory as { turns?: { topics?: Topic[] }[] } | null)?.turns ?? [];
    const list = out.get(r.caseId) ?? [];
    list.push(...turns.map((t) => t.topics ?? []));
    out.set(r.caseId, list);
  }
  return out;
}

/**
 * Every set of topics each case's turns have ever been given, across all past
 * checks. The topic labeller only sees the parent's words, the recent
 * conversation and the program names, so this is the best evidence of which
 * details and rules a case can see.
 */
function pastTopics(caseIds: string[]): Map<string, Topic[][]> {
  const out = new Map<string, Topic[][]>();
  if (caseIds.length === 0) return out;
  const rows = db
    .select({ caseId: evalResults.caseId, trajectory: evalResults.trajectory })
    .from(evalResults)
    .where(inArray(evalResults.caseId, caseIds))
    .all();
  for (const r of rows) {
    const turns = (r.trajectory as { turns?: { topics?: Topic[] }[] } | null)?.turns ?? [];
    const list = out.get(r.caseId) ?? [];
    list.push(...turns.map((t) => t.topics ?? []));
    out.set(r.caseId, list);
  }
  return out;
}

/**
 * How each case has done on one version of the club details, over every check
 * on record with the same grader: the evidence for whether a failure after a
 * change is new or just how that test behaves.
 */
function record(snapshotHash: string, graderVersion: string, caseIds: string[]): Record<string, CaseOutcome> {
  const out: Record<string, CaseOutcome> = {};
  if (caseIds.length === 0) return out;
  const rows = db
    .select({ caseId: evalResults.caseId, scores: evalResults.scores })
    .from(evalResults)
    .innerJoin(evalRuns, eq(evalResults.runId, evalRuns.id))
    .where(
      and(
        eq(evalRuns.snapshotHash, snapshotHash),
        eq(evalRuns.graderVersion, graderVersion),
        inArray(evalResults.caseId, caseIds),
      ),
    )
    .all();
  for (const r of rows) {
    const o = (out[r.caseId] ??= { passes: 0, total: 0, rate: 0 });
    o.total++;
    if (overallPass(r.scores as Scores)) o.passes++;
  }
  for (const o of Object.values(out)) o.rate = o.passes / o.total;
  return out;
}

/**
 * `code`: the two runs are the same club details on two versions of the code
 * (a prompt or model change; see scripts/eval.ts). Every test is then reached
 * by the change, and only the "before" run itself counts as the record: older
 * checks on the same details ran on code that may no longer exist.
 */
export function compare(liveId: string, draftId: string, opts: { code?: boolean } = {}): Comparison {
  const live = summarize(liveId).perCase;
  const draft = summarize(draftId).perCase;
  const liveRun = getRun(liveId)!;
  const history = opts.code ? live : record(liveRun.snapshotHash, liveRun.graderVersion, Object.keys(draft));
  const before = getById(liveRun.snapshotId)!.data;
  const after = getById(getRun(draftId)!.snapshotId)!.data;
  const liveTopics = turnTopics(liveId);
  const draftTopics = turnTopics(draftId);
  const ids = new Set([...Object.keys(live), ...Object.keys(draft)]);
  const changes: CaseChange[] = [];
  let same = 0;
  for (const id of ids) {
    const l = live[id] ?? null;
    const d = draft[id] ?? null;
    if (!l || !d) continue;
    const v = verdict(l, d, history[id] ?? l);
    if (v === null) {
      same++;
      continue;
    }
    const topics = [...(liveTopics.get(id) ?? []), ...(draftTopics.get(id) ?? [])];
    const untouched = !opts.code && !changeReaches(before, after, topics);
    changes.push({ caseId: id, live: l, draft: d, verdict: untouched ? "unsteady" : v, ...(untouched ? { untouched } : {}) });
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
  // A test the change can't reach - the same details and rules for every
  // topic it has ever touched - can't come out differently because of it, so
  // it isn't replayed. A test with no history yet is always replayed.
  const all = listCases({ activeOnly: true });
  const history = pastTopics(all.map((c) => c.id));
  const cases = all.filter((c) => {
    const topics = history.get(c.id);
    return !topics?.length || changeReaches(live.data, draft.data, topics);
  });
  const notReached = all.length - cases.length;

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
    // Tests the change doesn't reach need no more tries: nothing there can be its fault.
    const changed = cases.filter((c) => first.changes.some((ch) => ch.caseId === c.id && !ch.untouched));
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
    finishRun(draftRunId, draftCost, {
      baselineRunId: liveRunId,
      comparison: { ...compare(liveRunId, draftRunId), notReached },
    });
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

/** The owner keeps tests written on their request: from now on every check runs them. */
export function keepCases(caseIds: string[]): void {
  if (caseIds.length === 0) return;
  db.update(evalCases)
    .set({ pending: false, active: true })
    .where(and(inArray(evalCases.id, caseIds), eq(evalCases.pending, true)))
    .run();
}

/** A requested test the owner doesn't want. It never ran, so nothing else refers to it. */
export function removePendingCase(caseId: string): void {
  db.delete(evalCases).where(and(eq(evalCases.id, caseId), eq(evalCases.pending, true))).run();
}

/**
 * The newest finished check of the live assistant on its own, the one the
 * owner's headline score comes from. Falls back to the "before" side of a
 * before/after check when there is no plain check yet.
 */
export function latestLiveCheck(): RunRow | null {
  const runs = listRuns(30);
  return (
    runs.find((r) => r.status === "done" && !r.summary?.baselineRunId && r.label !== "Live (before)") ??
    runs.find((r) => r.status === "done" && r.label === "Live (before)") ??
    null
  );
}
