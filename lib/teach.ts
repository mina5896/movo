import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod";

import { getMessage, getThread } from "@/lib/db/conversations";
import { getOrCreateDraft } from "@/lib/db/snapshots";
import { parseStructured } from "@/lib/engine/client";
import { MODELS } from "@/lib/engine/models";
import { formatKnowledge } from "@/lib/eval/graders/judge";
import { proposeFix } from "@/lib/feedback";

/**
 * When the owner answers a question the assistant handed over, their answer
 * often holds something every family could be told ("Little Kicks does take
 * 4-year-olds"). This spots that and offers it as a change to the club
 * details, through the same proposal, check and publish as a correction, so
 * the same question stops coming back to the owner.
 *
 * Decisions for one family (a refund, a call time) are not lessons; those
 * stay with the owner.
 */
const LessonSchema = z.object({
  teachable: z
    .boolean()
    .describe(
      "True only if the owner's reply states a fact or policy that applies to every family, that the assistant could have told this parent itself, and that the club details don't already say.",
    ),
  lesson: z
    .string()
    .describe("If teachable: the general fact or policy, in one plain sentence in the owner's voice. Empty otherwise."),
});

/** The handed-over assistant reply that an owner message answers, if any. */
function handedOverBefore(threadId: string, ownerMessageId: string) {
  const thread = getThread(threadId);
  if (!thread) return null;
  const idx = thread.messages.findIndex((m) => m.id === ownerMessageId);
  for (let i = idx - 1; i >= 0; i--) {
    const m = thread.messages[i];
    if (m.role === "owner") return null;
    if (m.role === "assistant" && m.escalated) return { thread, handedOver: m };
  }
  return null;
}

/** Looks for a lesson in the owner's reply and, if there is one, proposes it. Never throws. */
export async function suggestLesson(ownerMessageId: string): Promise<void> {
  const owner = getMessage(ownerMessageId);
  if (!owner || owner.role !== "owner") return;
  const found = handedOverBefore(owner.threadId, ownerMessageId);
  if (!found) return;
  const { thread, handedOver } = found;
  const idx = thread.messages.findIndex((m) => m.id === handedOver.id);
  const convo = thread.messages
    .slice(Math.max(0, idx - 6), thread.messages.findIndex((m) => m.id === ownerMessageId) + 1)
    .map((m) => `${m.role === "parent" ? "PARENT" : m.role === "owner" ? "OWNER" : "ASSISTANT"}: ${m.body}`)
    .join("\n\n");

  try {
    const response = await parseStructured({
      model: MODELS.JUDGE,
      max_tokens: 3000,
      system: `A youth soccer club's assistant handed a parent's question to the club's owner, and the owner answered it. Decide whether the owner's answer teaches the assistant something it could tell any family next time.

Teachable: a general fact or policy (an age exception, a new date, what to bring, a policy detail the club details lack).
Not teachable: a decision or arrangement for this one family (a refund, a call time, an exception "just this once"), a judgment call, an apology, or anything the club details already say.

When in doubt, it isn't teachable: the owner will be asked, and a needless question costs them time.`,
      messages: [
        {
          role: "user",
          content: `## Club details the assistant has

${formatKnowledge(getOrCreateDraft().data)}

## Conversation

${convo}`,
        },
      ],
      output_config: { format: zodOutputFormat(LessonSchema), effort: "low" },
    });
    const out = response.parsed_output;
    if (!out?.teachable || !out.lesson.trim()) return;

    await proposeFix(
      handedOver.id,
      `The assistant handed this to me and I answered: "${owner.body}". What any family could be told: ${out.lesson.trim()} Teach the assistant this so it can answer this itself next time.`,
      { ownerMessageId },
    );
  } catch (err) {
    console.error(`lesson from ${ownerMessageId} failed`, err);
  }
}
