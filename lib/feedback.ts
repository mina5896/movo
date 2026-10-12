import { randomUUID } from "node:crypto";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { desc, eq } from "drizzle-orm";
import * as z from "zod";

import { getMessage, getThread } from "@/lib/db/conversations";
import { db } from "@/lib/db";
import { evalCases, feedback } from "@/lib/db/schema";
import { getDraft, getLive, getOrCreateDraft, saveDraft } from "@/lib/db/snapshots";
import { EngineError, parseStructured } from "@/lib/engine/client";
import { MODELS } from "@/lib/engine/models";
import { TOPICS, type Knowledge, type Program, type Topic } from "@/lib/engine/snapshot";
import type { Expectations } from "@/lib/eval/types";

const PROGRAM_FIELDS = ["name", "ages", "schedule", "price", "availability", "notes"] as const;

const ChangeSchema = z.object({
  type: z
    .enum(["add_rule", "edit_rule", "edit_program", "edit_policy"])
    .describe(
      "add_rule: a new behaviour instruction. edit_rule: reword an existing rule. edit_program / edit_policy: a club fact was wrong or missing.",
    ),
  rule_id: z.string().describe("edit_rule only: id of the rule to reword. Empty otherwise."),
  rule_scope: z
    .array(z.enum(TOPICS))
    .describe(
      "add_rule only: the topics this rule applies to. Keep it as narrow as the note allows, so it never leaks into unrelated conversations. Empty array means it applies to every conversation - use that only for tone or honesty rules.",
    ),
  program_id: z.string().describe("edit_program only: id of the program. Empty otherwise."),
  program_field: z.enum([...PROGRAM_FIELDS, ""]).describe("edit_program only: which field. Empty otherwise."),
  policy_id: z.string().describe("edit_policy only: id of the policy. Empty otherwise."),
  new_value: z
    .string()
    .describe("The rule text in the owner's voice, or the new value of the field. Complete, not a diff."),
});

const ProposalSchema = z.object({
  summary: z.string().describe("One or two plain sentences telling the owner what will change. No jargon."),
  changes: z.array(ChangeSchema).describe("Usually one. Only what the owner's note asks for."),
  test: z.object({
    title: z.string().describe("Short name for the test, e.g. 'Camp dates after the change'."),
    criteria: z
      .string()
      .describe("What a good reply to the same parent message must do, so this mistake can never come back."),
    must_escalate: z.enum(["yes", "no", "either"]),
    must_not_mention: z
      .array(z.string())
      .describe("Short phrases the reply must never contain, only when the note is about something said wrongly. Usually empty."),
  }),
});

export type Proposal = z.infer<typeof ProposalSchema>;
export type FeedbackRow = Omit<typeof feedback.$inferSelect, "proposal"> & { proposal: Proposal | null };

function describeKnowledge(k: Knowledge): string {
  return [
    "Programs:",
    ...k.programs.map(
      (p) =>
        `- id=${p.id} | ${p.name} | ages ${p.ages} | ${p.schedule} | ${p.price}${p.availability ? ` | availability: ${p.availability}` : ""}${p.notes ? ` | notes: ${p.notes}` : ""}`,
    ),
    "",
    "Policies:",
    ...k.policies.map((p) => `- id=${p.id} | ${p.name}: ${p.detail}`),
    "",
    "Rules:",
    ...k.rules
      .filter((r) => r.active)
      .map((r) => `- id=${r.id} | applies to: ${r.scope === "always" ? "every conversation" : r.scope.join(", ")} | ${r.text}`),
  ].join("\n");
}

/** The parent messages leading up to the corrected reply, which become the test's script. */
function parentScript(threadId: string, messageId: string): { messages: string[]; channel: "text" | "voice" } {
  const thread = getThread(threadId)!;
  const idx = thread.messages.findIndex((m) => m.id === messageId);
  const before = thread.messages.slice(0, idx).filter((m) => m.role === "parent");
  const target = thread.messages[idx];
  return { messages: before.slice(-3).map((m) => m.body), channel: target.channel };
}

/**
 * Turns the owner's plain-words note into a concrete, reviewable proposal: the
 * smallest change to the club details or rules, plus a test pinned to the
 * conversation that went wrong. Nothing is applied until the owner approves.
 */
export async function proposeFix(
  messageId: string,
  ownerNote: string,
  teach?: { ownerMessageId: string },
): Promise<FeedbackRow> {
  const msg = getMessage(messageId);
  if (!msg || msg.role !== "assistant") throw new Error("can only correct an assistant reply");
  const thread = getThread(msg.threadId)!;
  const idx = thread.messages.findIndex((m) => m.id === messageId);
  // A lesson from the owner's own reply needs that reply in view as well.
  const end = teach ? thread.messages.findIndex((m) => m.id === teach.ownerMessageId) + 1 : idx + 1;
  const context = thread.messages
    .slice(Math.max(0, idx - 6), Math.max(end, idx + 1))
    .map((m) => {
      const tag =
        m.id === messageId
          ? teach
            ? " (handed to the owner)"
            : " (the reply being corrected)"
          : m.id === teach?.ownerMessageId
            ? " (the owner's own reply)"
            : "";
      return `${m.role.toUpperCase()}${tag}: ${m.body}`;
    })
    .join("\n\n");

  // Propose against the draft if there is one, so a second correction builds on the first.
  const base = getOrCreateDraft();

  const response = await parseStructured({
    model: MODELS.ANSWERER,
    max_tokens: 8000,
    system: `You help the owner of a youth soccer club correct their text and phone assistant. The owner is not technical. They describe what was wrong in their own words; you turn that into the smallest precise change to the assistant's club details or rules, plus a test that catches the mistake if it ever comes back.

Prefer fixing a fact when the assistant said something because a club detail is wrong or missing. Prefer a rule when the problem is behaviour or tone. Reword an existing rule instead of adding a near-duplicate. Write rules as clear instructions in the owner's voice.

Scope rules narrowly. A rule that applies to every conversation will be read in all of them; a note about fees must not end up in conversations about schedules.`,
    messages: [
      {
        role: "user",
        content: `## Current club details and rules

${describeKnowledge(base.data)}

## The conversation

${context}

## The owner's note about the marked reply

${ownerNote}`,
      },
    ],
    output_config: { format: zodOutputFormat(ProposalSchema), effort: "medium" },
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new EngineError(`no proposal (stop_reason=${response.stop_reason})`, "unparseable");
  }

  const id = randomUUID();
  db.insert(feedback)
    .values({
      id,
      messageId,
      ownerNote,
      proposal: response.parsed_output,
      status: "pending",
      ...(teach ? { kind: "teach" as const, ownerMessageId: teach.ownerMessageId } : {}),
    })
    .run();
  return getFeedback(id)!;
}

export function getFeedback(id: string): FeedbackRow | null {
  return (db.select().from(feedback).where(eq(feedback.id, id)).get() as FeedbackRow) ?? null;
}

export function feedbackForMessages(messageIds: string[]): FeedbackRow[] {
  if (messageIds.length === 0) return [];
  const all = db.select().from(feedback).orderBy(desc(feedback.createdAt)).all() as FeedbackRow[];
  const set = new Set(messageIds);
  return all.filter((f) => set.has(f.messageId));
}

export function listFeedback(): FeedbackRow[] {
  return db.select().from(feedback).orderBy(desc(feedback.createdAt)).all() as FeedbackRow[];
}

function applyChange(k: Knowledge, c: Proposal["changes"][number], messageId: string): Knowledge {
  const next: Knowledge = structuredClone(k);
  switch (c.type) {
    case "add_rule":
      next.rules.push({
        id: `fb-${randomUUID().slice(0, 8)}`,
        text: c.new_value,
        scope: c.rule_scope.length ? (c.rule_scope as Topic[]) : "always",
        source: "feedback",
        createdFromMessageId: messageId,
        active: true,
      });
      break;
    case "edit_rule": {
      const r = next.rules.find((x) => x.id === c.rule_id);
      if (!r) throw new Error(`rule ${c.rule_id} not found`);
      r.text = c.new_value;
      break;
    }
    case "edit_program": {
      const p = next.programs.find((x) => x.id === c.program_id);
      if (!p || !c.program_field) throw new Error(`program ${c.program_id} not found`);
      (p as Program)[c.program_field] = c.new_value;
      break;
    }
    case "edit_policy": {
      const p = next.policies.find((x) => x.id === c.policy_id);
      if (!p) throw new Error(`policy ${c.policy_id} not found`);
      p.detail = c.new_value;
      break;
    }
  }
  return next;
}

/**
 * Applies an approved proposal to the draft (never to live) and saves the test
 * case. The test joins every future check, which is what stops the same
 * mistake from being corrected twice.
 */
export function approveFix(feedbackId: string): void {
  const fb = getFeedback(feedbackId);
  if (!fb?.proposal || fb.status !== "pending") throw new Error("nothing to approve");
  const msg = getMessage(fb.messageId)!;

  const draft = getOrCreateDraft();
  let data = draft.data;
  for (const c of fb.proposal.changes) data = applyChange(data, c, msg.id);
  saveDraft(data);

  const script = parentScript(msg.threadId, msg.id);
  const t = fb.proposal.test;
  const expectations: Expectations = {
    criteria: `${t.criteria} (Owner's original note: "${fb.ownerNote}")`,
    ...(t.must_escalate !== "either" ? { mustEscalate: t.must_escalate === "yes" } : {}),
    ...(t.must_not_mention.length ? { mustNotMention: t.must_not_mention } : {}),
  };
  const caseId = `fb-${feedbackId.slice(0, 8)}`;
  db.insert(evalCases)
    .values({
      id: caseId,
      title: t.title,
      tags: ["feedback"],
      turns: { channel: script.channel, messages: script.messages },
      expectations,
      source: "feedback",
      originMessageId: msg.id,
    })
    .run();

  db.update(feedback).set({ status: "applied", evalCaseId: caseId }).where(eq(feedback.id, feedbackId)).run();
}

/** Called on publish: every approved correction is now what parents get. */
export function markFixesPublished(): void {
  db.update(feedback).set({ status: "published" }).where(eq(feedback.status, "applied")).run();
}

/** Called when the owner throws away the draft, which held the approved corrections. */
export function markFixesDiscarded(): void {
  db.update(feedback).set({ status: "dismissed" }).where(eq(feedback.status, "applied")).run();
}

export function dismissFix(feedbackId: string): void {
  db.update(feedback).set({ status: "dismissed" }).where(eq(feedback.id, feedbackId)).run();
}

/** Plain-words description of one change, for the owner's review screen. */
export function describeChange(c: Proposal["changes"][number]): string {
  const k = (getDraft() ?? getLive()).data;
  switch (c.type) {
    case "add_rule":
      return `New rule${c.rule_scope.length ? ` (only for: ${c.rule_scope.join(", ")})` : " (every conversation)"}: "${c.new_value}"`;
    case "edit_rule": {
      const r = k.rules.find((x) => x.id === c.rule_id);
      return `Reword rule "${r?.text ?? c.rule_id}" to "${c.new_value}"`;
    }
    case "edit_program": {
      const p = k.programs.find((x) => x.id === c.program_id);
      return `${p?.name ?? c.program_id} - ${c.program_field}: "${p ? (p[c.program_field as keyof Program] ?? "(empty)") : "?"}" → "${c.new_value}"`;
    }
    case "edit_policy": {
      const p = k.policies.find((x) => x.id === c.policy_id);
      return `${p?.name ?? c.policy_id} policy: "${p?.detail ?? "?"}" → "${c.new_value}"`;
    }
  }
}

