import type Anthropic from "@anthropic-ai/sdk";

import {
  OWNER_ONLY_TOPICS,
  policiesForTopics,
  rulesForTopics,
  type Knowledge,
  type Rule,
  type Topic,
} from "./snapshot";

/**
 * The part of the prompt that does not depend on the parent's question: who
 * the club is, every program, and the contract the assistant answers under.
 * It is emitted first and marked cacheable so the volatile tail (scoped rules,
 * conversation history, the new message) can change without re-billing it.
 *
 * All four programs are always included - they are small, and a parent asking
 * "anything Saturday for a 5 and a 7 year old" needs to see several at once.
 * Policies and rules are the things that get scoped.
 */
function stableSystem(k: Knowledge): string {
  const programs = k.programs
    .map((p) => {
      const lines = [
        `- ${p.name} (ages ${p.ages})`,
        `  Schedule: ${p.schedule}`,
        `  Price: ${p.price}`,
      ];
      if (p.availability) lines.push(`  Availability: ${p.availability}`);
      if (p.notes) lines.push(`  Notes: ${p.notes}`);
      return lines.join("\n");
    })
    .join("\n");

  return `You are the assistant for ${k.club.name}, a youth soccer club. You answer parents by text and by voice on the club's behalf.

Location: ${k.club.location}

## Programs

${programs}

## How you must answer

Everything you tell a parent must come from the club details given to you in this prompt. You have no other source.

If the club details do not answer the question, say so plainly, tell the parent you will check with the owner and get back to them, and set escalate. Never guess a price, a date, a time or an availability. Never soften a gap by giving a plausible-sounding answer.

Set escalate to true when any of these is true:
- The club details do not contain the answer.
- The matter is one the owner handles personally: ${OWNER_ONLY_TOPICS.join(", ")}.
- The parent asks to speak to a person, or asks for a call.
- The parent is upset, or the matter needs judgement rather than information.

When you escalate, still reply to the parent: acknowledge what they asked, say the owner will follow up, and be specific about what happens next. Do not promise a time you have not been given.

Keep replies short enough to read comfortably as a text message.`;
}

/** The turn-specific tail: only the policies and rules in scope for this topic. */
function scopedSystem(k: Knowledge, topics: Topic[], rules: Rule[]): string {
  const policies = policiesForTopics(k, topics);
  const sections: string[] = [];

  if (policies.length > 0) {
    sections.push(
      `## Club policies relevant to this message\n\n${policies
        .map((p) => `- ${p.name}: ${p.detail}`)
        .join("\n")}`,
    );
  }

  if (rules.length > 0) {
    sections.push(
      `## The owner's rules for this message\n\nFollow these exactly. They come from the club owner and override your own judgement about style or content.\n\n${rules
        .map((r) => `- ${r.text}`)
        .join("\n")}`,
    );
  }

  // An explicit empty marker beats an absent section: it tells the model the
  // scoping ran and found nothing, rather than leaving it to infer.
  if (sections.length === 0) return "No additional policies or rules apply to this message.";
  return sections.join("\n\n");
}

export type BuiltPrompt = {
  system: Anthropic.TextBlockParam[];
  injectedRules: Rule[];
  topics: Topic[];
};

/**
 * Assembles the system prompt for one turn. The returned `injectedRules` is
 * what the code actually put in front of the model - not what the model later
 * claims it used - so the owner's view of "which rules produced this answer"
 * is a fact rather than a self-report.
 */
export function buildPrompt(k: Knowledge, topics: Topic[]): BuiltPrompt {
  const injectedRules = rulesForTopics(k, topics);
  return {
    topics,
    injectedRules,
    system: [
      {
        type: "text",
        text: stableSystem(k),
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: scopedSystem(k, topics, injectedRules) },
    ],
  };
}
