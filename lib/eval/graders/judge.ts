import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod";

import { anthropic, EngineError } from "@/lib/engine/client";
import { MODELS, type Usage } from "@/lib/engine/models";
import type { Knowledge, Rule } from "@/lib/engine/snapshot";

import type { Expectations, Scores } from "../types";

/** Bump when the judge prompt or model changes: scores across versions aren't comparable. */
export const GRADER_VERSION = `judge-v1:${MODELS.JUDGE}`;

const Verdict = z.object({ pass: z.boolean(), reason: z.string() });
const JudgeSchema = z.object({
  correct: Verdict.describe(
    "Every fact in the reply matches the club details. Nothing invented: no guessed prices, dates, times, availability or policies.",
  ),
  rules: Verdict.describe("The reply follows every owner rule listed as applying to this conversation."),
  handoff: Verdict.describe(
    "It handed the conversation to the owner exactly when it should: owner-only matters, gaps in the club details, requests for a person, upset parents.",
  ),
  tone: Verdict.describe(
    "Short and friendly, uses the parent's first name when known, never pressures the family. Sounds like a small local club, not a corporate bot.",
  ),
  expectation: Verdict.describe("The reply meets this test's specific expectation."),
});

function formatKnowledge(k: Knowledge): string {
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

Write every reason in one plain sentence the owner can understand without knowing how the assistant works. Quote the problem words when failing.

The assistant's only source of truth is the club details below. If the reply states something the club details don't support, "correct" fails, even if it sounds plausible.`,
    messages: [
      {
        role: "user",
        content: `## Club details (the truth for this test)

${formatKnowledge(input.knowledge)}

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
  return { scores: response.parsed_output, usage: response.usage };
}
