/**
 * Compares answer settings for phone calls: speed against the same checks a
 * normal check uses. Every hand-written single-message test is asked on a
 * call, plus the voice tests a simulated parent wrote.
 *
 * Run: npx tsx --env-file=.env.local scripts/compare-voice.ts  (about $1.50)
 */
import { writeFileSync } from "node:fs";
import { getLive } from "@/lib/db/snapshots";
import { answer, type AnswerResult, type Tuning, type Turn } from "@/lib/engine/answer";
import { costOf, MODELS } from "@/lib/engine/models";
import { deterministicScores } from "@/lib/eval/graders/deterministic";
import { judge } from "@/lib/eval/graders/judge";
import { overallPass, type CaseTurns, type Expectations } from "@/lib/eval/types";
import { SEED_CASES } from "@/lib/eval/cases";
import SIMULATED from "@/lib/eval/simulated-cases.json";

type C = { id: string; turns: CaseTurns; expectations: Expectations };
const sim = SIMULATED as C[];
// Every voice test, plus the hand-written single-message tests asked on a call.
const cases: C[] = [
  ...sim.filter((c) => c.turns.channel === "voice"),
  ...SEED_CASES.filter((c) => c.turns.messages.length === 1).map((c) => ({ ...c, turns: { ...c.turns, channel: "voice" as const } })),
];
const CONFIGS: Record<string, Tuning> = {
  "opus-medium": { model: MODELS.ANSWERER, effort: "medium" },
  "opus-low": { model: MODELS.ANSWERER, effort: "low" },
  "sonnet-low": { model: "claude-sonnet-5-5", effort: "low" },
};

async function run(name: string, tuning: Tuning, c: C) {
  const k = getLive().data;
  const history: Turn[] = [];
  const replies: AnswerResult[] = [];
  const times: number[] = [];
  let cost = 0;
  const now = c.turns.now ? new Date(c.turns.now) : new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const notices = (c.turns.notices ?? []).map((n) => ({ text: n.text, createdAt: nowSec - 3600, expiresAt: nowSec + 86400 }));
  for (const message of c.turns.messages) {
    const t = Date.now();
    const r = await answer({ knowledge: k, history, message, channel: "voice", parentFirstName: c.turns.parentFirstName ?? "Sam", now, notices, tuning });
    times.push(Date.now() - t);
    cost += r.costUsd;
    replies.push(r);
    history.push({ role: "parent", body: message }, { role: "assistant", body: r.reply, topics: r.topics });
  }
  const det = deterministicScores({ replies: replies.map((r) => r.reply), escalatedAny: replies.some((r) => r.escalate), unsupported: replies.at(-1)!.grounding.unsupported }, c.expectations);
  const j = await judge({
    knowledge: k, appliedRules: replies.at(-1)!.usedRules,
    conversation: c.turns.messages.flatMap((m, i) => [{ role: "parent" as const, body: m }, { role: "assistant" as const, body: replies[i].reply, escalated: replies[i].escalate }]),
    expectations: c.expectations, parentFirstName: c.turns.parentFirstName ?? "Sam", channel: "voice", context: replies.at(-1)!.context,
  });
  const scores = { ...j.scores, ...det };
  return { name, id: c.id, times, pass: overallPass(scores), cost, judgeCost: costOf(MODELS.JUDGE, j.usage),
    fails: Object.entries(scores).filter(([, s]) => !s!.pass).map(([a, s]) => `${a}: ${s!.reason}`), reply: replies.at(-1)!.reply, retried: replies.some((r) => r.grounding.retried) };
}

async function main() {
  const out: Awaited<ReturnType<typeof run>>[] = [];
  const jobs = Object.entries(CONFIGS).flatMap(([n, t]) => cases.map((c) => ({ n, t, c })));
  const q = [...jobs];
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (q.length) { const { n, t, c } = q.shift()!; try { out.push(await run(n, t, c)); } catch (e) { console.error(n, c.id, String(e).slice(0, 200)); } }
  }));
  writeFileSync("data/compare-voice.json", JSON.stringify(out, null, 2));
  for (const n of Object.keys(CONFIGS)) {
    const rs = out.filter((r) => r.name === n);
    const ts = rs.flatMap((r) => r.times).sort((a, b) => a - b);
    const q = (p: number) => (ts[Math.min(ts.length - 1, Math.floor(p * ts.length))] / 1000).toFixed(1);
    console.log(`${n}: pass ${rs.filter((r) => r.pass).length}/${rs.length}, turn median ${q(0.5)}s p90 ${q(0.9)}s, $${(rs.reduce((s, r) => s + r.cost, 0) / ts.length).toFixed(4)}/turn, retried ${rs.filter((r) => r.retried).length}`);
  }
}
main();
