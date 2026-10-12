import { randomBytes } from "node:crypto";

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod";

import { db } from "@/lib/db";
import { evalCases } from "@/lib/db/schema";
import { getLive } from "@/lib/db/snapshots";
import { answer, type Turn } from "@/lib/engine/answer";
import { parseStructured } from "@/lib/engine/client";
import { costOf, MODELS } from "@/lib/engine/models";
import { OWNER_ONLY_TOPICS, TOPICS, type Knowledge, type Topic } from "@/lib/engine/snapshot";

import { formatKnowledge } from "./graders/judge";
import type { CaseTurns, Expectations } from "./types";

/**
 * Writes new test conversations on request ("10 tests about refunds"), so the
 * owner isn't limited to the tests someone thought of up front.
 *
 * A simulated parent (Claude Sonnet 5.5) plans each test as a person with a
 * reason to get in touch, then actually talks to the live assistant, so a
 * follow-up reacts to a real reply. What it said is then frozen into a script:
 * a test has to say the same thing on every run, or a before/after check
 * would be comparing two different conversations.
 *
 * What a good answer looks like is written by a separate call that sees the
 * club details and the parent's messages but never the assistant's replies, so
 * a test can't quietly bake in a mistake the assistant made while it was
 * being written.
 */

/** Tests answer at a pinned time, so "tonight" means the same day on every run (a Tuesday afternoon). */
const PINNED_NOW = "2026-10-13T19:00:00Z";

export type GeneratedCase = {
  id: string;
  title: string;
  tags: string[];
  turns: CaseTurns;
  expectations: Expectations;
};

const PlanSchema = z.object({
  tests: z.array(
    z.object({
      title: z.string().describe("A short plain title for the club owner, e.g. 'Refund after the first class'."),
      first_name: z.string().describe("The parent's first name."),
      persona: z
        .string()
        .describe("Two sentences: who this parent is, their mood, how they write, and what they actually want to find out."),
      opening: z.string().describe("The parent's first message, exactly as this parent would type or say it."),
      messages: z.number().describe("How many messages this parent sends in total: 1, 2 or 3."),
      channel: z.enum(["text", "voice"]).describe("voice: the parent is on a phone call, so no typos or emoji."),
      topics: z.array(z.string()).describe(`What the conversation is about, from: ${TOPICS.join(", ")}.`),
    }),
  ),
});

const NextSchema = z.object({
  message: z.string().describe("The parent's next message, or empty if this parent would be done now."),
});

const ExpectSchema = z.object({
  thinking: z
    .string()
    .describe("What the club details and rules say about what this parent asked, and whether it is the owner's to handle."),
  hand_off: z
    .enum(["yes", "no", "either"])
    .describe(
      "yes: it must be handed to the owner. no: the club details fully answer it, so handing it off would be needless. either: both are reasonable.",
    ),
  criteria: z.string().describe("What a good final reply does, in one to three plain sentences."),
});

function clubText(k: Knowledge): string {
  const rules = k.rules
    .filter((r) => r.active)
    .map((r) => `- ${r.text} (${r.scope === "always" ? "every conversation" : `when about ${r.scope.join(", ")}`})`)
    .join("\n");
  return `${formatKnowledge(k)}\n\nThe owner's rules:\n${rules}`;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

type Plan = z.infer<typeof PlanSchema>["tests"][number];

async function plan(k: Knowledge, about: string, count: number, avoid: string[]) {
  const response = await parseStructured({
    model: MODELS.PARENT_SIM,
    max_tokens: 16000,
    system: `You write test conversations for a youth soccer club's assistant, which answers parents by text and on the phone. Each test is a believable parent with a real reason to get in touch.

Make them varied and realistic:
- how they write: typos and no punctuation, terse, long-winded, two questions at once, upset, unsure, in a hurry;
- what makes them hard: an age right at a program's edge, a full class, two children in different programs, a policy with an exception, a question the club details don't answer, something only the owner should handle (${OWNER_ONLY_TOPICS.join(", ").replaceAll("_", " ")});
- about one in four on a phone call;
- most send one message; some send two or three, following up on the reply;
- unless the subject is something only the owner handles, most should be questions the club details fully answer, so a good assistant answers them itself: a test that only checks "hand it to the owner" teaches little.

Every test must be about the subject asked for. Never repeat a test the club already has. Titles never use he or she.`,
    messages: [
      {
        role: "user",
        content: `## Club details

${clubText(k)}

## Tests the club already has

${avoid.length ? avoid.map((t) => `- ${t}`).join("\n") : "(none)"}

## Write ${count} new tests about: ${about}`,
      },
    ],
    output_config: { format: zodOutputFormat(PlanSchema), effort: "medium" },
  });
  if (!response.parsed_output) throw new Error(`no test plan (stop_reason=${response.stop_reason})`);
  return { tests: response.parsed_output.tests.slice(0, count), cost: costOf(response.model, response.usage) };
}

/** The simulated parent's next message, reacting to what the assistant actually said. */
async function nextMessage(p: Plan, convo: Turn[], index: number) {
  const response = await parseStructured({
    model: MODELS.PARENT_SIM,
    max_tokens: 8000,
    system: `You play a parent in a ${p.channel === "voice" ? "phone call" : "text conversation"} with a youth soccer club's assistant. Stay in character.

Who you are: ${p.persona}
Your first name: ${p.first_name}

Write your next message as this parent would, digging further into what you came for: a detail you still need, a "what about...", a correction of something you said, or pushing back on the answer. Keep it short and natural${p.channel === "voice" ? ", as spoken words" : ""}. Never ask when the owner will get back to you, and never send just thanks or goodbye. This is message ${index + 1} of about ${p.messages}. If you already have what you needed, leave it empty.`,
    messages: [
      {
        role: "user",
        content: convo.map((t) => `${t.role === "parent" ? "YOU" : "CLUB ASSISTANT"}: ${t.body}`).join("\n\n"),
      },
    ],
    output_config: { format: zodOutputFormat(NextSchema), effort: "low" },
  });
  return { message: response.parsed_output?.message.trim() ?? "", cost: costOf(response.model, response.usage) };
}

/** What a good answer does - written without seeing the assistant's replies. */
async function expectations(k: Knowledge, p: Plan, messages: string[]) {
  const response = await parseStructured({
    model: MODELS.JUDGE,
    max_tokens: 16000,
    system: `You write the pass standard for a test conversation with a youth soccer club's assistant. A grader will hold the assistant's final reply to it, reading the club details as they are on the day of the test.

Write what a good final reply does, in one to three plain sentences, like these:
- "Points to Little Kicks (ages 3-5) with its correct price, and mentions the free trial."
- "States the refund policy accurately (full refund only before the first class, credit after that). Does not promise cash back."
- "Acknowledges the parent warmly, does not defend or judge the coach, and says the owner will follow up personally."

Rules for a fair test:
- Never copy a price, date, time or address from the club details. Say "its correct price", "the camp dates" or "where the fields are", so the test still holds after the owner edits the details.
- The final reply is the next message in the conversation: it needn't repeat what earlier replies already said.
- Only require asking for a phone number or a time to call when the parent asked for a call.
- Name only the two or three things that decide pass or fail, not every detail the parent mentioned. No exact wording, no length limits beyond "short" on a phone call.
- Refer to the parent as "the parent" or by first name, never as he or she.
- If the club details don't answer something, a good reply says it will check with the owner rather than guessing.
- Hand-off: "yes" for ${OWNER_ONLY_TOPICS.join(", ").replaceAll("_", " ")}, a request for a call, or anything the details can't answer that the parent needs answered. "no" only when the details fully answer everything asked. Otherwise "either".`,
    messages: [
      {
        role: "user",
        content: `## Club details

${clubText(k)}

## The parent (${p.channel === "voice" ? "on a phone call" : "by text"})

${messages.map((m, i) => `Message ${i + 1}: ${m}`).join("\n")}`,
      },
    ],
    output_config: { format: zodOutputFormat(ExpectSchema), effort: "medium" },
  });
  const out = response.parsed_output;
  if (!out) throw new Error(`no expectations (stop_reason=${response.stop_reason})`);
  const e: Expectations = { criteria: out.criteria.trim() };
  if (out.hand_off !== "either") e.mustEscalate = out.hand_off === "yes";
  return { expectations: e, cost: costOf(response.model, response.usage) };
}

/** Names the step that failed, so a failure can be traced to the call that made it. */
function step<T>(name: string, p: Promise<T>): Promise<T> {
  return p.catch((err) => {
    throw new Error(`${name}: ${err instanceof Error ? err.message : err}`);
  });
}

/** Plays one planned test against the assistant and freezes it into a script. */
async function writeOne(k: Knowledge, p: Plan) {
  let cost = 0;
  const now = new Date(PINNED_NOW);
  const history: Turn[] = [];
  const messages: string[] = [];
  const total = Math.min(3, Math.max(1, Math.round(p.messages)));

  for (let i = 0; i < total; i++) {
    let message = p.opening.trim();
    if (i > 0) {
      const next = await step("parent's next message", nextMessage(p, history, i));
      cost += next.cost;
      if (!next.message) break;
      message = next.message;
    }
    messages.push(message);
    // The last reply isn't needed to write the script; only replies a follow-up reacts to are.
    if (i === total - 1) break;
    const r = await step("assistant's reply", answer({ knowledge: k, history, message, channel: p.channel, parentFirstName: p.first_name, now }));
    cost += r.costUsd;
    history.push({ role: "parent", body: message }, { role: "assistant", body: r.reply, topics: r.topics });
  }

  const e = await step("expectations", expectations(k, p, messages));
  cost += e.cost;
  const c: GeneratedCase = {
    id: `sim-${slug(p.title)}-${randomBytes(2).toString("hex")}`,
    title: p.title.trim(),
    // Only known topics become tags; the planner occasionally invents one.
    tags: [
      ...new Set<string>([
        ...p.topics.filter((t): t is Topic => (TOPICS as readonly string[]).includes(t)),
        "simulated",
        ...(p.channel === "voice" ? ["voice"] : []),
      ]),
    ],
    turns: { channel: p.channel, messages, parentFirstName: p.first_name, now: PINNED_NOW },
    expectations: e.expectations,
  };
  return { c, cost };
}

/**
 * Writes `count` new tests about `about` against the given club details. Tests
 * that fail to write are dropped rather than saved half-made.
 */
export async function generateCases(
  k: Knowledge,
  about: string,
  count: number,
  avoid: string[],
): Promise<{ cases: GeneratedCase[]; costUsd: number }> {
  const planned = await plan(k, about, count, avoid);
  let costUsd = planned.cost;
  const cases: GeneratedCase[] = [];
  const queue = [...planned.tests];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const p = queue.shift()!;
        // One more try: a call cut off mid-answer is usually fine the second time.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const { c, cost } = await writeOne(k, p);
            cases.push(c);
            costUsd += cost;
            break;
          } catch (err) {
            console.error(`writing test "${p.title}" failed: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
    }),
  );
  return { cases, costUsd };
}

type WritingJob = { id: string; about: string; count: number; startedAt: number; error?: string };

const jobs: Map<string, WritingJob> = ((globalThis as unknown as { __movoWriting?: Map<string, WritingJob> }).__movoWriting ??=
  new Map());

/** Requests still being written, and ones that failed, newest first. */
export function writingJobs(): WritingJob[] {
  return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function dismissWritingJob(id: string): void {
  jobs.delete(id);
}

/**
 * Writes tests on the owner's request. They're saved as waiting for the
 * owner to look over: a test nobody has read could hold a wrong expectation
 * and raise false alarms on every check after.
 */
export async function writeTestsForOwner(about: string, count: number): Promise<void> {
  const job: WritingJob = { id: randomBytes(4).toString("hex"), about, count, startedAt: Date.now() };
  jobs.set(job.id, job);
  try {
    const avoid = db
      .select({ title: evalCases.title, turns: evalCases.turns })
      .from(evalCases)
      .all()
      .map((c) => `${c.title}: "${(c.turns as CaseTurns).messages[0]}"`);
    const { cases } = await generateCases(getLive().data, about, count, avoid);
    if (cases.length === 0) throw new Error("no tests written");
    db.insert(evalCases)
      .values(cases.map((c) => ({ ...c, tags: [...c.tags, "requested"], source: "generated" as const, pending: true, active: false })))
      .run();
    jobs.delete(job.id);
  } catch (err) {
    console.error(`writing tests about "${about}" failed`, err);
    job.error = "Couldn't write these tests. Try again in a minute.";
  }
}
