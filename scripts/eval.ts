/**
 * Runs every active test conversation against the live club details and
 * prints the result - the same run the owner starts from "How it's doing".
 *
 * It's also the before/after check for code. The owner's check compares two
 * versions of the club details; a prompt or model change needs the same thing
 * across two versions of the code:
 *
 *   npm run eval -- --reps 3                     # on the current code; note the run id
 *   (change the code)
 *   npm run eval -- --reps 3 --against <run id>  # on the new code, compared with it
 *
 * With 3 tries a side, a test is called worse only when chance can't explain
 * it (lib/eval/verdict.ts). About $0.50 per try of every test.
 */
import { execSync } from "node:child_process";

import { getLive } from "@/lib/db/snapshots";
import { compare, getRun, runErrors, runResults, startRun } from "@/lib/eval/runner";
import { AXIS_LABELS, overallPass, type Axis, type Scores } from "@/lib/eval/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** The code version a run was made on, so a comparison says what it compared. */
function codeVersion(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain -- lib app", { encoding: "utf8" }).trim() !== "";
    return dirty ? `${sha} + uncommitted changes` : sha;
  } catch {
    return "unknown code version";
  }
}

async function main() {
  const reps = Number(arg("reps") ?? 1);
  const against = arg("against");
  if (against && !getRun(against)) throw new Error(`no run ${against}`);

  const runId = startRun(getLive().id, `Live check (CLI, ${codeVersion()})`, reps);
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

  if (against) {
    const before = getRun(against)!;
    const c = compare(against, runId, { code: true });
    console.log(`\nCompared with ${against} (${before.label}):`);
    console.log(`  ${(before.summary!.passRate * 100).toFixed(0)}% -> ${(run.summary.passRate * 100).toFixed(0)}%, ${c.same} the same`);
    for (const v of ["worse", "better", "unsteady"] as const) {
      const items = c.changes.filter((x) => x.verdict === v);
      if (items.length === 0) continue;
      console.log(`  ${v === "unsteady" ? "mixed" : v} (${items.length}):`);
      for (const x of items) console.log(`    ${x.caseId}  ${x.live?.passes}/${x.live?.total} -> ${x.draft?.passes}/${x.draft?.total}`);
    }
    if (reps < 3) console.log("  (with fewer than 3 tries a side, little can be called worse or better: use --reps 3)");
    return;
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
