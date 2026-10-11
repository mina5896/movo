/**
 * Runs every active test conversation against the live snapshot and prints
 * the result - the same run the owner starts from "How it's doing".
 *
 * Run: npm run eval
 */
import { getLive } from "@/lib/db/snapshots";
import { getRun, runErrors, runResults, startRun } from "@/lib/eval/runner";
import { AXIS_LABELS, overallPass, type Axis, type Scores } from "@/lib/eval/types";

async function main() {
  const runId = startRun(getLive().id, "Live check (CLI)", 1);
  console.log(`run ${runId}`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const run = getRun(runId)!;
    if (run.status !== "running") break;
    process.stdout.write(".");
  }
  const run = getRun(runId)!;
  console.log(`\nstatus=${run.status} cost=$${run.costUsd}`);
  if (!run.summary) return;
  console.log(`pass rate ${(run.summary.passRate * 100).toFixed(0)}% over ${run.summary.cases} cases`);
  for (const [axis, s] of Object.entries(run.summary.axes)) {
    console.log(`  ${AXIS_LABELS[axis as Axis]}: ${s!.pass}/${s!.total}`);
  }
  for (const r of runResults(runId).filter((r) => !overallPass(r.scores as Scores))) {
    console.log(`\nFAIL ${r.caseId}\n  reply: ${r.reply}`);
    for (const [axis, s] of Object.entries(r.scores as Scores)) {
      if (!s!.pass) console.log(`  ${axis}: ${s!.reason}`);
    }
  }
  for (const e of runErrors(runId)) console.log(`\nERROR ${e.caseId} [${e.failureClass}] ${e.message}`);
}

main();
