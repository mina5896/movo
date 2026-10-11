import { randomUUID } from "node:crypto";
import { desc, eq, inArray, notInArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { calibrationLabels, evalCases, evalResults, evalRuns } from "@/lib/db/schema";

import { overallPass, type Scores } from "./types";

const AXIS = "overall";

/**
 * A graded answer the owner hasn't labelled yet, drawn from recent runs. Half
 * the time it prefers one the grader failed, so the owner sees both kinds and
 * the agreement rate isn't just "the grader passes most things".
 */
export function nextToReview() {
  const runIds = db
    .select({ id: evalRuns.id })
    .from(evalRuns)
    .where(eq(evalRuns.status, "done"))
    .orderBy(desc(evalRuns.startedAt))
    .limit(6)
    .all()
    .map((r) => r.id);
  if (runIds.length === 0) return null;

  const labelled = db.select({ id: calibrationLabels.resultId }).from(calibrationLabels).all().map((r) => r.id);
  const candidates = db
    .select()
    .from(evalResults)
    .where(labelled.length ? notInArray(evalResults.id, labelled) : inArray(evalResults.runId, runIds))
    .all()
    .filter((r) => runIds.includes(r.runId));
  if (candidates.length === 0) return null;

  const failed = candidates.filter((r) => !overallPass(r.scores as Scores));
  const pool = failed.length && Math.random() < 0.5 ? failed : candidates;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const c = db.select().from(evalCases).where(eq(evalCases.id, pick.caseId)).get();
  return {
    resultId: pick.id,
    title: c?.title ?? pick.caseId,
    criteria: (c?.expectations as { criteria?: string } | undefined)?.criteria ?? "",
    turns: ((pick.trajectory as { turns?: { parent: string; reply: string }[] } | null)?.turns ?? []).map((t) => ({
      parent: t.parent,
      reply: t.reply,
    })),
    escalated: pick.escalated,
    remaining: candidates.length - 1,
  };
}

export function saveLabel(resultId: string, label: "pass" | "fail", note?: string) {
  const r = db.select().from(evalResults).where(eq(evalResults.id, resultId)).get();
  if (!r) throw new Error("result not found");
  db.insert(calibrationLabels)
    .values({ id: randomUUID(), resultId, axis: AXIS, ownerLabel: label, ownerNote: note || null })
    .run();
  const scores = r.scores as Scores;
  return { graderPass: overallPass(scores), agreed: overallPass(scores) === (label === "pass"), scores };
}

/** How often the grader's overall verdict matches the owner's own call. */
export function agreement() {
  const rows = db
    .select({ label: calibrationLabels.ownerLabel, scores: evalResults.scores })
    .from(calibrationLabels)
    .innerJoin(evalResults, eq(calibrationLabels.resultId, evalResults.id))
    .where(eq(calibrationLabels.axis, AXIS))
    .all();
  let agreed = 0;
  let graderTooEasy = 0;
  let graderTooHarsh = 0;
  for (const r of rows) {
    const g = overallPass(r.scores as Scores);
    const o = r.label === "pass";
    if (g === o) agreed++;
    else if (g) graderTooEasy++;
    else graderTooHarsh++;
  }
  return { reviewed: rows.length, agreed, graderTooEasy, graderTooHarsh };
}
