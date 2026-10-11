/**
 * Verifies the answer engine against the live snapshot with a handful of the
 * brief's own example messages, including two that must escalate.
 *
 * Run: npm run smoke
 */
import { getLive } from "@/lib/db/snapshots";
import { answer } from "@/lib/engine/answer";

const CASES: { message: string; expect: string }[] = [
  { message: "hi how much is soccer for a 4 yr old", expect: "$120, Little Kicks, free trial" },
  { message: "is there practice tonight its pouring", expect: "weather policy, 2 hours before" },
  {
    message: "Coach Mike yelled at my daughter at practice and now she doesn't want to go back",
    expect: "ESCALATE - coach concern",
  },
  { message: "can someone just call me, easier to explain", expect: "ESCALATE - wants a call" },
];

async function main() {
  const live = getLive();
  console.log(`live snapshot ${live.hash} - ${live.data.programs.length} programs, ${live.data.rules.length} rules\n`);

  let total = 0;
  for (const c of CASES) {
    const r = await answer({
      knowledge: live.data,
      history: [],
      message: c.message,
      channel: "text",
    });
    const cost = r.costUsd;
    total += cost;
    console.log(`parent  > ${c.message}`);
    console.log(`expected: ${c.expect}`);
    console.log(`assistant> ${r.reply}`);
    console.log(
      `  escalate=${r.escalate}${r.escalationReason ? ` (${r.escalationReason})` : ""} topics=[${r.topics.join(", ")}] rules=[${r.usedRules.map((x) => x.id).join(", ")}]`,
    );
    console.log(
      `  model=${r.servedModel} status=${r.status} ${r.latencyMs}ms cache_read=${r.usage.cache_read_input_tokens ?? 0} ~$${cost.toFixed(4)}\n`,
    );
  }
  console.log(`total ~$${total.toFixed(4)}`);
}

main();
