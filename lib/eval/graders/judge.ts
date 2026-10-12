import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod";

import { anthropic, EngineError } from "@/lib/engine/client";
import { addUsage, MODELS, type Usage } from "@/lib/engine/models";
import type { Knowledge, Rule } from "@/lib/engine/snapshot";

import type { Expectations, Scores } from "../types";

/** Bump when the judge prompt or model changes: scores across versions aren't comparable. */
export const GRADER_VERSION = `judge-v3:${MODELS.JUDGE}`;

// The reason comes before the verdict, so the verdict follows from the
// reasoning instead of being decided first and justified after. (v1 had them
// the other way round and failed answers its own reasons called fine.) v3
// confirms each quoted unsupported statement on its own (see below).
const Verdict = z.object({ reason: z.string(), pass: z.boolean() });
const JudgeSchema = z.object({
  correct: z
    .object({
      unsupported: z
        .array(z.string())
        .describe(
          "Exact quotes of each statement in the reply that the club details, the date and notices, or the conversation do not support. A correct calculation or a plain reading of the details is supported. Empty if every statement is supported.",
        ),
      reason: z.string(),
    })
    .describe("Every fact in the reply matches the club details. Nothing invented: no guessed prices, dates, times, availability or policies."),
  rules: Verdict.describe("The reply follows every owner rule listed as applying to this conversation."),
  handoff: Verdict.describe(
    "It handed the conversation to the owner exactly when it should: owner-only matters, gaps in the club details, requests for a person, upset parents.",
  ),
  tone: Verdict.describe(
    "Short and friendly, uses the parent's first name when known, never pressures the family. Sounds like a small local club, not a corporate bot.",
  ),
  expectation: Verdict.describe("The reply meets this test's specific expectation."),
});

export function formatKnowledge(k: Knowledge): string {
  const programs = k.programs
    .map(
      (p) =>
        `- ${p.name} (ages ${p.ages}). Schedule: ${p.schedule}. Price: ${p.price}.${
          p.availability ? ` Availability: ${p.availability}` : ""
        }${p.notes ? ` Notes: ${p.notes}` : ""}`,
    )
    .join("\n");
  const policies = k.policies.map((p) => `- ${p.name}: ${p.detail}`).join("\n");
  return `Club: ${k.club.name}, ${k.club.location}\n\nPrograms:\n${programs}\n\nPolicies:\n${policies}`;
}

export type JudgeInput = {
  knowledge: Knowledge;
  /** The rules the engine injected for the final turn. */
  appliedRules: Pick<Rule, "id" | "text">[];
  conversation: { role: "parent" | "assistant"; body: string; escalated?: boolean }[];
  expectations: Expectations;
  parentFirstName?: string;
  channel: "text" | "voice";
  /** Today's date and the notices in force, exactly as the assistant saw them. */
  context: string;
};

/**
 * Grades the final assistant reply against the snapshot that produced it, so a
 * changed price is judged against the new price rather than a stale answer key.
 * The judge is a different model from the answerer; see lib/engine/models.ts.
 */
export async function judge(input: JudgeInput): Promise<{ scores: Scores; usage: Usage }> {
  const convo = input.conversation
    .map((m) =>
      m.role === "parent"
        ? `PARENT: ${m.body}`
        : `ASSISTANT${m.escalated ? " (handed to owner)" : ""}: ${m.body}`,
    )
    .join("\n\n");

  const rules = input.appliedRules.length
    ? input.appliedRules.map((r) => `- ${r.text}`).join("\n")
    : "(none)";

  const response = await anthropic().messages.parse({
    model: MODELS.JUDGE,
    max_tokens: 8000,
    system: `You grade replies from the text and phone assistant of a youth soccer club, on behalf of the club's owner. Grade strictly but fairly: fail an axis only for a real problem a careful owner would care about, never for a stylistic preference.

Write every reason in one plain sentence the owner can understand without knowing how the assistant works. Quote the problem words when failing. Work out any arithmetic or timing step by step before deciding.

The assistant's only source of truth is the club details below. If the reply states something the club details don't support, "correct" fails, even if it sounds plausible.`,
    messages: [
      {
        role: "user",
        content: `## Club details (the truth for this test)

${formatKnowledge(input.knowledge)}

${input.context}

## Owner rules that applied to the final reply

${rules}

## Conversation (${input.channel === "voice" ? "a phone call, replies are spoken aloud" : "text messages"}; parent's first name: ${input.parentFirstName ?? "unknown"})

${convo}

## This test's specific expectation

${input.expectations.criteria}

Grade the FINAL assistant reply, using the earlier messages as context.`,
      },
    ],
    output_config: { format: zodOutputFormat(JudgeSchema), effort: "medium" },
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new EngineError(`judge returned no verdict (stop_reason=${response.stop_reason})`, "grader");
  }
  // "Correct" fails only on quoted statements that a second, narrower look
  // confirms one by one. A judge grading five things at once sometimes fails a
  // reply while its own reason calls it fine; checking each quote on its own is
  // much steadier, and only costs anything when something was quoted.
  const { correct, ...rest } = response.parsed_output;
  let usage: Usage = response.usage;
  let unsupported = correct.unsupported.filter((q) => q.trim());
  if (unsupported.length > 0) {
    const confirmed = await confirmUnsupported(input, unsupported);
    usage = addUsage(usage, confirmed.usage);
    unsupported = confirmed.unsupported;
  }
  const scores: Scores = {
    ...rest,
    correct: unsupported.length
      ? { pass: false, reason: `Not supported by the club details: ${unsupported.map((q) => `"${q}"`).join("; ")}. ${correct.reason}` }
      : { pass: true, reason: "Every statement is supported by the club details." },
  };
  return { scores, usage };
}

const ClaimsSchema = z.object({
  claims: z.array(
    z.object({
      quote: z.string(),
      reason: z.string().describe("Where the club details, date, notices or conversation say this, or why they don't."),
      supported: z.boolean(),
    }),
  ),
});

/** Checks each quoted statement on its own and returns the ones that really aren't supported. */
async function confirmUnsupported(input: JudgeInput, quotes: string[]): Promise<{ unsupported: string[]; usage: Usage }> {
  const response = await anthropic().messages.parse({
    model: MODELS.JUDGE,
    max_tokens: 4000,
    system: `You check statements a youth soccer club's assistant made to a parent. For each one, decide whether the club details, the date and notices, or the conversation support it. A correct calculation or a plain reading of the details counts as supported. A statement is unsupported only if it says something the sources don't say or gets something wrong.`,
    messages: [
      {
        role: "user",
        content: `## Club details

${formatKnowledge(input.knowledge)}

${input.context}

## Conversation

${input.conversation.map((m) => `${m.role === "parent" ? "PARENT" : "ASSISTANT"}: ${m.body}`).join("\n\n")}

## Statements to check

${quotes.map((q, i) => `${i + 1}. "${q}"`).join("\n")}`,
      },
    ],
    output_config: { format: zodOutputFormat(ClaimsSchema), effort: "low" },
  });
  const out = response.parsed_output;
  // If the second look fails, keep the first verdict rather than pass it silently.
  if (!out) return { unsupported: quotes, usage: response.usage };
  return { unsupported: out.claims.filter((c) => !c.supported).map((c) => c.quote), usage: response.usage };
}
