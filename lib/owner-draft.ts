import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import * as z from "zod";

import { getThread } from "@/lib/db/conversations";
import { db } from "@/lib/db";
import { threads } from "@/lib/db/schema";
import { getLive } from "@/lib/db/snapshots";
import { anthropic } from "@/lib/engine/client";
import { describeContext } from "@/lib/engine/context";
import { costOf, MODELS } from "@/lib/engine/models";
import { formatKnowledge } from "@/lib/eval/graders/judge";
import { activeNotices, toNotice } from "@/lib/db/notices";

/**
 * When the assistant hands a conversation over, a reply is drafted for the
 * owner from the club details, so answering is "fill in a blank and send"
 * rather than starting from nothing. Anything only the owner can know or
 * decide is left as a [blank] that has to be filled in before it can be sent:
 * the draft must never put a guess in the owner's mouth.
 */
export type OwnerDraft = {
  /** The assistant reply that handed the conversation over. */
  forMessageId: string;
  body: string;
  /** What the owner needs to decide or check, in plain words. */
  unsure: string[];
  costUsd?: number;
  at: number;
};

const DraftSchema = z.object({
  reply: z
    .string()
    .describe(
      "The owner's reply to the parent, in the first person as the owner. Short and warm. Every fact must come from the club details or the conversation; anything else is a [blank in square brackets] saying what goes there.",
    ),
  unsure: z
    .array(z.string())
    .describe("Each thing the owner must decide or check before sending, one short plain line each. Empty if none."),
});

export function getOwnerDraft(raw: unknown): OwnerDraft | null {
  return (raw as OwnerDraft | null) ?? null;
}

/** Drafts the owner's reply for a handed-over conversation. Never throws. */
export async function draftOwnerReply(threadId: string, forMessageId: string): Promise<void> {
  const thread = getThread(threadId);
  if (!thread) return;
  const idx = thread.messages.findIndex((m) => m.id === forMessageId);
  if (idx < 0) return;
  const convo = thread.messages
    .slice(Math.max(0, idx - 12), idx + 1)
    .map((m) => `${m.role === "parent" ? "PARENT" : m.role === "owner" ? "OWNER" : "ASSISTANT"}: ${m.body}`)
    .join("\n\n");
  const live = getLive();

  try {
    const response = await anthropic().messages.parse({
      model: MODELS.JUDGE,
      max_tokens: 4000,
      system: `You draft replies for the owner of a youth soccer club. Their text and phone assistant handed this conversation to the owner, and the owner will read your draft, fill in any blanks, and send it as themselves.

Write as the owner, in the first person. Keep it short and warm, the way a busy club owner texts. Answer what the parent is waiting on.

Never guess. Use only the club details and the conversation. Anything the owner has to know or decide - a time they can call, whether to make an exception, a refund, something the club details don't say - goes in as a [blank in square brackets] describing what belongs there, e.g. "I can call you [day and time]". The owner can't send the draft until every blank is filled in, so a blank is always safer than a guess.

Don't repeat what the assistant already told them, and don't promise anything the club details don't support.

Keep blanks short and plain, e.g. "[what to bring]". In the notes for the owner, refer to the parent by first name, never as he or she.`,
      messages: [
        {
          role: "user",
          content: `## Club details

${formatKnowledge(live.data)}

${describeContext(new Date(), activeNotices().map(toNotice))}

## Why the assistant handed this over

${thread.attentionReason ?? "(not given)"}

## Conversation (the parent's first name is ${thread.family.parentFirstName})

${convo}`,
        },
      ],
      output_config: { format: zodOutputFormat(DraftSchema), effort: "low" },
    });
    const out = response.parsed_output;
    if (!out) throw new Error(`no draft (stop_reason=${response.stop_reason})`);

    // The owner may have answered while this ran; a draft would then be noise.
    const latest = getThread(threadId);
    if (!latest || latest.messages.slice(idx + 1).some((m) => m.role === "owner")) return;

    const draft: OwnerDraft = {
      forMessageId,
      body: out.reply.trim(),
      unsure: out.unsure.filter((u) => u.trim()),
      costUsd: costOf(response.model, response.usage),
      at: Math.floor(Date.now() / 1000),
    };
    db.update(threads).set({ ownerDraft: draft }).where(eq(threads.id, threadId)).run();
  } catch (err) {
    console.error(`owner draft for ${threadId} failed`, err);
  }
}
