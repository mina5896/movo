"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";

import { postOwnerReply, setThreadStatus } from "@/lib/db/conversations";
import {
  discardDraft,
  getDraft,
  getLive,
  getOrCreateDraft,
  publishDraft,
  saveDraft,
} from "@/lib/db/snapshots";
import { answer, type Turn } from "@/lib/engine/answer";
import { TOPICS, type Knowledge, type Topic } from "@/lib/engine/snapshot";
import { saveLabel } from "@/lib/eval/calibration";
import { setCaseActive, startComparison, startRun } from "@/lib/eval/runner";
import { approveFix, dismissFix, proposeFix } from "@/lib/feedback";

// No auth: this is a local single-owner demo (see DECISIONS.md). Every action
// still validates its input, since server actions are reachable by direct POST.

export async function replyAction(threadId: string, body: string) {
  const text = z.string().trim().min(1).max(2000).parse(body);
  postOwnerReply(threadId, text);
  refresh();
}

export async function setStatusAction(threadId: string, status: "open" | "needs_attention" | "resolved") {
  setThreadStatus(threadId, z.enum(["open", "needs_attention", "resolved"]).parse(status));
  refresh();
}

export async function proposeFixAction(messageId: string, note: string): Promise<{ error?: string }> {
  const text = z.string().trim().min(3).max(2000).safeParse(note);
  if (!text.success) return { error: "Say what was wrong in a few words." };
  try {
    await proposeFix(messageId, text.data);
  } catch (err) {
    console.error(err);
    return { error: "Couldn't work out a fix just now. Try again in a moment." };
  }
  refresh();
  return {};
}

export async function approveFixAction(feedbackId: string) {
  approveFix(feedbackId);
  refresh();
}

export async function dismissFixAction(feedbackId: string) {
  dismissFix(feedbackId);
  refresh();
}

const ProgramSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  ages: z.string().trim().min(1),
  schedule: z.string().trim().min(1),
  price: z.string().trim().min(1),
  availability: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});
const PolicySchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  topic: z.enum(TOPICS),
  detail: z.string().trim().min(1),
});
const RuleSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1),
  scope: z.union([z.literal("always"), z.array(z.enum(TOPICS)).min(1)]),
  source: z.enum(["owner", "feedback"]),
  createdFromMessageId: z.string().optional(),
  active: z.boolean(),
});
const KnowledgeSchema = z.object({
  club: z.object({ name: z.string().trim().min(1), location: z.string().trim().min(1) }),
  programs: z.array(ProgramSchema),
  policies: z.array(PolicySchema),
  rules: z.array(RuleSchema),
});

export async function saveDraftAction(data: Knowledge): Promise<{ error?: string }> {
  const parsed = KnowledgeSchema.safeParse(data);
  if (!parsed.success) {
    return { error: "Some fields are empty. Every program and policy needs all its main fields filled in." };
  }
  // Drop empty optional strings so they don't count as a change.
  const clean: Knowledge = {
    ...parsed.data,
    programs: parsed.data.programs.map((p) => ({
      ...p,
      availability: p.availability || undefined,
      notes: p.notes || undefined,
    })),
  };
  saveDraft(clean);
  refresh();
  return {};
}

export async function discardDraftAction() {
  discardDraft();
  refresh();
}

export async function publishDraftAction(label: string) {
  publishDraft(z.string().trim().min(1).max(120).catch("Updated club details").parse(label));
  refresh();
}

export async function checkImpactAction() {
  const draft = getOrCreateDraft();
  const { draftRunId } = startComparison(getLive().id, draft.id);
  redirect(`/owner/tests/${draftRunId}`);
}

export async function runLiveTestsAction() {
  const runId = startRun(getLive().id, "Live check", 1);
  redirect(`/owner/tests/${runId}`);
}

export async function setCaseActiveAction(caseId: string, active: boolean) {
  setCaseActive(caseId, active);
  refresh();
}

/** The owner talking to the draft as a parent would. Nothing is stored. */
export async function tryDraftAction(
  history: Turn[],
  message: string,
  channel: "text" | "voice",
): Promise<
  { reply: string; escalate: boolean; escalationReason: string | null; rules: string[]; topics: Topic[] } | { error: string }
> {
  const text = z.string().trim().min(1).max(2000).safeParse(message);
  if (!text.success) return { error: "Type a message." };
  const snapshot = getDraft() ?? getLive();
  try {
    const r = await answer({
      knowledge: snapshot.data,
      history: history.slice(-20),
      message: text.data,
      channel,
      parentFirstName: "Sam",
    });
    return {
      reply: r.reply,
      escalate: r.escalate,
      escalationReason: r.escalationReason,
      rules: r.usedRules.map((x) => x.text),
      topics: r.topics,
    };
  } catch (err) {
    console.error(err);
    return { error: "The assistant couldn't answer just now." };
  }
}

export async function labelAction(resultId: string, label: "pass" | "fail", note?: string) {
  const r = saveLabel(z.string().parse(resultId), z.enum(["pass", "fail"]).parse(label), note?.slice(0, 1000));
  return r;
}
