import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import * as z from "zod";

import { getThread } from "@/lib/db/conversations";
import { db } from "@/lib/db";
import { families } from "@/lib/db/schema";
import { getLive } from "@/lib/db/snapshots";
import { parseStructured } from "@/lib/engine/client";
import { costOf, MODELS } from "@/lib/engine/models";
import { STAGES, type FamilyProfile } from "@/lib/profile";

/**
 * What a family has told us, kept up to date after every parent message: who
 * the children are, what they're interested in, whether they want a trial and
 * how to reach them. The owner sees it as a card on the conversation and in
 * the inbox, so a family interested in a trial doesn't get lost in the
 * scrollback.
 *
 * It holds only what the parent said in the conversation, and only what a
 * club needs to follow up: first names and ages, not health details or
 * anything looked up elsewhere (see DECISIONS.md).
 */
const ProfileSchema = z.object({
  children: z
    .array(z.object({ name: z.string().describe("First name, or empty if not given."), age: z.string().describe("Age as the parent said it, or empty.") }))
    .describe("Each child the parent mentioned."),
  interested_in: z.array(z.string()).describe("Names of the club's programs the family is asking about, exactly as the club names them."),
  stage: z
    .enum(STAGES)
    .describe(
      "just_asking: general questions. interested: asking about a specific program for their child. wants_trial: asked about or agreed to a free trial. ready_to_register: wants to sign up or pay. member: already plays at the club.",
    ),
  trial: z.string().describe("If they want a trial: which session or day, in a few words. Empty otherwise."),
  phone: z.string().describe("A phone number the parent gave in the conversation. Empty if none."),
  email: z.string().describe("An email the parent gave. Empty if none."),
  best_time: z.string().describe("When they said they're easiest to reach. Empty if not said."),
  follow_up: z
    .string()
    .describe(
      "One short line the owner should remember for next time, written as a fragment that starts with a verb and uses no he, she, his or her, e.g. 'Wants Saturday mornings only', 'Moving here in March', 'Wants a call back about the kids' progress'. No health or medical details. Empty if nothing.",
    ),
});

/** Re-reads the family's conversation and updates what we know about them. Never throws. */
export async function updateProfile(threadId: string): Promise<void> {
  const thread = getThread(threadId);
  if (!thread || !thread.messages.some((m) => m.role === "parent")) return;
  const convo = thread.messages
    .slice(-40)
    .map((m) => `${m.role === "parent" ? "PARENT" : m.role === "owner" ? "OWNER" : "ASSISTANT"}: ${m.body}`)
    .join("\n\n");
  const programs = getLive().data.programs.map((p) => `- ${p.name} (ages ${p.ages})`).join("\n");

  try {
    const response = await parseStructured({
      model: MODELS.CLASSIFIER,
      max_tokens: 2000,
      system: `You keep a short record of what a family has told a youth soccer club in a text or phone conversation, for the club owner. Record only what the parent actually said - never guess a name, age or number. A child's age can be inferred only from a clear statement ("she's turning 6"). Leave a field empty rather than guess. Refer to the parent by first name, never as he or she.`,
      messages: [
        {
          role: "user",
          content: `## The club's programs

${programs}

## Conversation (the parent's first name is ${thread.family.parentFirstName})

${convo}`,
        },
      ],
      output_config: { format: zodOutputFormat(ProfileSchema) },
    });
    const out = response.parsed_output;
    if (!out) throw new Error(`no profile (stop_reason=${response.stop_reason})`);
    const profile: FamilyProfile = {
      children: out.children.filter((c) => c.name.trim() || c.age.trim()),
      interestedIn: out.interested_in,
      stage: out.stage,
      trial: out.trial.trim(),
      phone: out.phone.trim(),
      email: out.email.trim(),
      bestTime: out.best_time.trim(),
      followUp: out.follow_up.trim(),
      costUsd: costOf(response.model, response.usage),
      at: Math.floor(Date.now() / 1000),
    };
    db.update(families).set({ profile }).where(eq(families.id, thread.familyId)).run();
  } catch (err) {
    console.error(`family profile for ${threadId} failed`, err);
  }
}
