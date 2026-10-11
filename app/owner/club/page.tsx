import { desc, eq } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";

import { db } from "@/lib/db";
import { evalRuns } from "@/lib/db/schema";
import { draftHasChanges, getDraft, getLive } from "@/lib/db/snapshots";
import { getRun, type RunSummary } from "@/lib/eval/runner";

import { AutoRefresh } from "../_components/auto-refresh";
import { ClubEditor, type ImpactStatus } from "./editor";

/** The newest before/after check of exactly this draft content, if any. */
function impactFor(draftHash: string): ImpactStatus {
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

async function Editor() {
  await connection();
  const live = getLive();
  const draft = getDraft();
  const hasChanges = draftHasChanges();
  const current = draft ?? live;
  const impact = hasChanges && draft ? impactFor(draft.hash) : ({ state: "none" } as const);

  return (
    <>
      {impact.state === "running" && <AutoRefresh every={4000} />}
      <ClubEditor
        key={`${current.id}:${current.hash}`}
        initial={current.data}
        live={live.data}
        hasDraft={!!draft}
        hasChanges={hasChanges}
        impact={impact}
      />
    </>
  );
}

export default function ClubPage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Club details &amp; rules</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Everything the assistant knows. Change it here, try it, check how answers change, then publish.
      </p>
      <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
        <Editor />
      </Suspense>
    </div>
  );
}
