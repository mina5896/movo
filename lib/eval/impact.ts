import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { evalRuns } from "@/lib/db/schema";
import { draftHasChanges, getDraft } from "@/lib/db/snapshots";

import { getRun, type RunSummary } from "./runner";

export type ImpactStatus =
  | { state: "none" }
  | { state: "running"; runId: string }
  | { state: "done"; runId: string; worse: number; better: number; unsteady: number; same: number }
  | { state: "failed"; runId: string };

/** The newest before/after check of exactly this draft content, if any. */
export function impactFor(draftHash: string): ImpactStatus {
  const runs = db
    .select()
    .from(evalRuns)
    .where(eq(evalRuns.snapshotHash, draftHash))
    .orderBy(desc(evalRuns.startedAt))
    .all()
    .filter((r) => (r.summary as RunSummary | null)?.baselineRunId);
  const latest = runs[0] ? getRun(runs[0].id) : null;
  if (!latest) return { state: "none" };
  if (latest.status === "running") return { state: "running", runId: latest.id };
  if (latest.status === "failed" || !latest.summary?.comparison) return { state: "failed", runId: latest.id };
  const ch = latest.summary.comparison.changes;
  return {
    state: "done",
    runId: latest.id,
    worse: ch.filter((c) => c.verdict === "worse").length,
    better: ch.filter((c) => c.verdict === "better").length,
    unsteady: ch.filter((c) => c.verdict === "unsteady").length,
    same: latest.summary.comparison.same,
  };
}

/** Where the owner's unpublished changes stand, or null when there are none. */
export function draftImpact(): ImpactStatus | null {
  const draft = getDraft();
  if (!draft || !draftHasChanges()) return null;
  return impactFor(draft.hash);
}
