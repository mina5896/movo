/** Exercises the owner's correction loop end to end: note -> proposal -> draft + test -> before/after check. */
import { getDraft, getLive } from "@/lib/db/snapshots";
import { getRun } from "@/lib/eval/runner";
import { startComparison } from "@/lib/eval/runner";
import { approveFix, describeChange, proposeFix } from "@/lib/feedback";

async function main() {
  const [messageId, ...noteWords] = process.argv.slice(2);
  const fb = await proposeFix(messageId, noteWords.join(" "));
  console.log("summary:", fb.proposal?.summary);
  for (const c of fb.proposal!.changes) console.log("change:", describeChange(c));
  console.log("test:", JSON.stringify(fb.proposal!.test));
  approveFix(fb.id);
  const draft = getDraft()!;
  console.log(`draft ${draft.hash} vs live ${getLive().hash}`);

  const { draftRunId, liveRunId } = startComparison(getLive().id, draft.id);
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    if (getRun(draftRunId)!.status !== "running") break;
    process.stdout.write(".");
  }
  const run = getRun(draftRunId)!;
  console.log(`\n${run.status} cost=$${(Number(run.costUsd) + Number(getRun(liveRunId)!.costUsd)).toFixed(3)}`);
  console.log(`url: /owner/tests/${draftRunId}`);
  for (const ch of run.summary?.comparison?.changes ?? []) {
    console.log(`${ch.verdict.padEnd(9)} ${ch.caseId}  live ${ch.live?.passes}/${ch.live?.total}  draft ${ch.draft?.passes}/${ch.draft?.total}`);
  }
  console.log(`same: ${run.summary?.comparison?.same}`);
}

main();
