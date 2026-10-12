/**
 * Rewrites the simulated-parent tests that ship with the app
 * (lib/eval/simulated-cases.json): a spread of subjects, written by
 * lib/eval/generate.ts against the live club details. Read the result before
 * committing it - a test with a wrong expectation raises false alarms on
 * every check after. The owner writes more from "How it's doing".
 *
 * Run: npx tsx --env-file=.env.local scripts/write-tests.ts  (about $2, 10 minutes)
 */
import { writeFileSync } from "node:fs";
import { getLive } from "@/lib/db/snapshots";
import { generateCases, type GeneratedCase } from "@/lib/eval/generate";
import { listCases } from "@/lib/eval/runner";

const SUBJECTS: [string, number][] = [
  ["prices, discounts and what's included", 5],
  ["which class fits a child's age and schedule", 6],
  ["free trial classes", 5],
  ["summer camp", 5],
  ["travel teams and tryouts", 5],
  ["weather and cancelled practices", 4],
  ["refunds and missed classes", 5],
  ["signing up and paying", 5],
  ["late pickup", 4],
  ["where the fields are and getting there", 3],
  ["upset parents and complaints about a coach", 4],
  ["injuries and health worries", 3],
  ["money worries and asking for financial help", 3],
  ["billing mistakes and charges", 3],
  ["parents phoning in with everyday questions", 5],
  ["vague messages, typos, and several questions at once", 4],
  ["questions the club details don't answer", 4],
  ["off-topic requests and attempts to misuse the assistant", 3],
];

async function main() {
  const k = getLive().data;
  const all: GeneratedCase[] = [];
  let cost = 0;
  const queue = [...SUBJECTS];
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const [about, n] = queue.shift()!;
      const avoid = [...listCases().filter((c) => c.source !== "generated"), ...all].map((c) => `${c.title}: "${c.turns.messages[0]}"`);
      const r = await generateCases(k, about, n, avoid).catch(() => generateCases(k, about, n, avoid));
      all.push(...r.cases);
      cost += r.costUsd;
      console.log(`${about}: ${r.cases.length}/${n}  total ${all.length}  $${cost.toFixed(2)}`);
      writeFileSync("lib/eval/simulated-cases.json", JSON.stringify(all, null, 2));
    }
  }));
  console.log("DONE");
}
main();
