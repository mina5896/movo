import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import * as z from "zod";

import { getMessage, getThread } from "@/lib/db/conversations";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { getById } from "@/lib/db/snapshots";
import { anthropic } from "@/lib/engine/client";
import { costOf, MODELS } from "@/lib/engine/models";
import { formatKnowledge } from "@/lib/eval/graders/judge";

/**
 * A second model reads every real reply after it is sent and flags the ones a
 * careful owner would want to see. Without this the owner only learns about a
 * bad answer by reading every conversation, which is the work the assistant
 * was meant to take off them.
 *
 * It runs after the parent already has the reply, so it never slows them down,
 * and it can only point the owner at a reply; changing anything still goes
 * through the owner's correction and the before/after check.
 */
export type ReviewState = "ok" | "flagged" | "dismissed" | "corrected" | "error";
export type Review = {
  state: ReviewState;
  /** Plain words for the owner: what may be wrong. */
  concern?: string;
  /** A correction in the owner's voice, offered as a starting point. */
  suggestion?: string;
  model?: string;
  costUsd?: number;
  /** "check": the figure check in code flagged it before the reviewer ran. */
  source?: "check" | "reviewer";
  at: number;
};

export const AUTO_REVIEW = process.env.MOVO_AUTO_REVIEW !== "off";

const Verdict = z.object({ ok: z.boolean(), reason: z.string() });
const ReviewSchema = z.object({
  correct: Verdict.describe(
    "Every fact matches the club details. Nothing invented: no guessed prices, dates, times, availability or policies.",
  ),
  rules: Verdict.describe("Follows every owner rule listed as applying."),
  handoff: Verdict.describe(
    "Handed to the owner when it should (owner-only matters, gaps in the club details, a request for a person, an upset parent), and told the parent what happens next. Did not hand off something it could answer.",
  ),
  tone: Verdict.describe("Short, friendly, uses the parent's first name when known, never pressures the family."),
  concern: z
    .string()
    .describe("If anything failed: one plain sentence for the owner saying what may be wrong, quoting the problem words. Empty if all ok."),
  suggestion: z
    .string()
    .describe(
      "If anything failed: what the owner would write to correct it, in their own voice, e.g. 'It should have asked for her number so I can call back.' Empty if all ok.",
    ),
});

const nowSec = () => Math.floor(Date.now() / 1000);

function setReview(messageId: string, review: Review) {
  db.update(messages).set({ review }).where(eq(messages.id, messageId)).run();
}

export function getReview(meta: unknown): Review | null {
  return (meta as Review | null) ?? null;
}

/** Reads one sent reply against the club details and rules it was given. Never throws. */
export async function reviewReply(messageId: string): Promise<void> {
  const msg = getMessage(messageId);
  if (!msg || msg.role !== "assistant" || !msg.snapshotId) return;
  // Already flagged by the figure check: that's a fact, not an opinion to overwrite.
  if (getReview(msg.review)?.state === "flagged") return;
  const snapshot = getById(msg.snapshotId);
  const thread = getThread(msg.threadId);
  if (!snapshot || !thread) return;

  const idx = thread.messages.findIndex((m) => m.id === messageId);
  const convo = thread.messages
    .slice(Math.max(0, idx - 8), idx + 1)
    .map((m) => {
      const who = m.role === "parent" ? "PARENT" : m.role === "owner" ? "CLUB OWNER" : "ASSISTANT";
      const tag = m.id === messageId ? " (the reply to review)" : m.escalated ? " (handed to owner)" : "";
      return `${who}${tag}: ${m.body}`;
    })
    .join("\n\n");
  const rules = ((msg.usedRules as { text: string }[] | null) ?? []).map((r) => `- ${r.text}`).join("\n") || "(none)";
  const meta = msg.meta as { nextStep?: string | null; context?: string } | null;
  const nextStep = meta?.nextStep;

  try {
    const response = await anthropic().messages.parse({
      model: MODELS.JUDGE,
      max_tokens: 8000,
      system: `You check replies that a youth soccer club's text and phone assistant has already sent to parents, on behalf of the club's owner. The owner will only look at the replies you flag, so flag only real problems a careful owner would want to fix: a wrong or invented fact, a broken rule, a missed or needless handoff, or a reply that would put a family off. Never flag wording you would merely have written differently.

The assistant's only source of truth is the club details below. If the reply states something they don't support, it is not correct, however plausible it sounds.`,
      messages: [
        {
          role: "user",
          content: `## Club details when the reply was sent

${formatKnowledge(snapshot.data)}

${meta?.context ?? ""}

## Owner rules the assistant was given for this reply

${rules}

## Conversation (${msg.channel === "voice" ? "a phone call, replies are spoken aloud" : "text messages"}; parent's first name: ${thread.family.parentFirstName})

${convo}

The assistant ${msg.escalated ? "handed this to the owner" : "did not hand this to the owner"}${nextStep ? ` and told the parent: "${nextStep}"` : ""}.

Review only the marked reply, using the earlier messages as context.`,
        },
      ],
      output_config: { format: zodOutputFormat(ReviewSchema), effort: "low" },
    });

    const out = response.parsed_output;
    if (!out) throw new Error(`no review (stop_reason=${response.stop_reason})`);
    const flagged = !(out.correct.ok && out.rules.ok && out.handoff.ok && out.tone.ok);
    const failed = [out.correct, out.rules, out.handoff, out.tone].filter((v) => !v.ok).map((v) => v.reason);
    setReview(messageId, {
      state: flagged ? "flagged" : "ok",
      ...(flagged
        ? { concern: out.concern || failed.join(" "), suggestion: out.suggestion || undefined }
        : {}),
      model: response.model,
      costUsd: costOf(response.model, response.usage),
      at: nowSec(),
    });
  } catch (err) {
    console.error(`review of ${messageId} failed`, err);
    setReview(messageId, { state: "error", at: nowSec() });
  }
}

/** The owner's answer to a flag: "it's fine", or they wrote a correction. */
export function resolveReview(messageId: string, state: "dismissed" | "corrected"): void {
  const msg = getMessage(messageId);
  const review = getReview(msg?.review);
  if (!review || review.state !== "flagged") return;
  setReview(messageId, { ...review, state, at: nowSec() });
}

/** How the owner has answered the reviewer's flags: the reviewer's track record. */
export function reviewStats() {
  const rows = db
    .select({ review: messages.review })
    .from(messages)
    .where(eq(messages.role, "assistant"))
    .all()
    .map((r) => getReview(r.review))
    .filter((r): r is Review => !!r);
  const count = (s: ReviewState) => rows.filter((r) => r.state === s).length;
  return {
    reviewed: rows.filter((r) => r.state !== "error").length,
    waiting: count("flagged"),
    corrected: count("corrected"),
    dismissed: count("dismissed"),
    costUsd: rows.reduce((s, r) => s + (r.costUsd ?? 0), 0),
  };
}
