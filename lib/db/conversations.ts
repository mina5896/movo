import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { answer, type AnswerResult, type Turn } from "@/lib/engine/answer";
import type { Topic } from "@/lib/engine/snapshot";

import { db } from "./index";
import { families, messages, threads } from "./schema";
import { getLive } from "./snapshots";

export type Channel = "text" | "voice";
export type ThreadStatus = "open" | "needs_attention" | "resolved";

export type MessageRow = typeof messages.$inferSelect;

export type ThreadSummary = {
  id: string;
  status: ThreadStatus;
  attentionReason: string | null;
  lastMessageAt: number;
  family: { id: string; parentFirstName: string; parentLastName: string | null; phone: string | null };
  lastMessage: { body: string; role: MessageRow["role"]; channel: Channel } | null;
  channels: Channel[];
  /** Replies the reviewer flagged that the owner hasn't looked at yet, newest first. */
  flagged: string[];
};

/** Assistant replies the reviewer flagged and the owner hasn't answered (see lib/review.ts). */
const isFlagged = sql`json_extract(${messages.review}, '$.state') = 'flagged'`;

function flaggedConcerns(threadId: string): string[] {
  return db
    .select({ review: messages.review })
    .from(messages)
    .where(and(eq(messages.threadId, threadId), isFlagged))
    .orderBy(desc(messages.createdAt))
    .all()
    .map((r) => (r.review as { concern?: string }).concern ?? "A reply may be wrong.");
}

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * A family is identified by phone when one is given, so a parent who texts and
 * later calls from the same number lands in the same thread. Without a phone
 * (the browser demo) a new family is created and the client keeps its id.
 */
export function startConversation(input: {
  parentFirstName: string;
  parentLastName?: string | null;
  phone?: string | null;
}): { familyId: string; threadId: string } {
  const phone = input.phone?.trim() || null;
  if (phone) {
    const existing = db.select().from(families).where(eq(families.phone, phone)).get();
    if (existing) {
      const thread = db
        .select()
        .from(threads)
        .where(eq(threads.familyId, existing.id))
        .orderBy(desc(threads.lastMessageAt))
        .get();
      if (thread) return { familyId: existing.id, threadId: thread.id };
    }
  }

  const familyId = randomUUID();
  const threadId = randomUUID();
  db.transaction((tx) => {
    tx.insert(families)
      .values({
        id: familyId,
        parentFirstName: input.parentFirstName.trim(),
        parentLastName: input.parentLastName?.trim() || null,
        phone,
      })
      .run();
    tx.insert(threads).values({ id: threadId, familyId, status: "open" }).run();
  });
  return { familyId, threadId };
}

export function listThreads(): ThreadSummary[] {
  const rows = db
    .select({ thread: threads, family: families })
    .from(threads)
    .innerJoin(families, eq(threads.familyId, families.id))
    .orderBy(
      // Anything waiting on the owner floats to the top, then most recent.
      sql`case when ${threads.status} = 'needs_attention' or exists (select 1 from ${messages} where ${messages.threadId} = ${threads.id} and ${isFlagged}) then 0 when ${threads.status} = 'open' then 1 else 2 end`,
      desc(threads.lastMessageAt),
    )
    .all();

  return rows.map(({ thread, family }) => {
    const last = db
      .select()
      .from(messages)
      .where(eq(messages.threadId, thread.id))
      .orderBy(desc(messages.createdAt), desc(sql`rowid`))
      .get();
    const channels = db
      .selectDistinct({ channel: messages.channel })
      .from(messages)
      .where(eq(messages.threadId, thread.id))
      .all()
      .map((r) => r.channel);
    return {
      id: thread.id,
      status: thread.status,
      attentionReason: thread.attentionReason,
      lastMessageAt: thread.lastMessageAt,
      family: {
        id: family.id,
        parentFirstName: family.parentFirstName,
        parentLastName: family.parentLastName,
        phone: family.phone,
      },
      lastMessage: last ? { body: last.body, role: last.role, channel: last.channel } : null,
      channels,
      flagged: flaggedConcerns(thread.id),
    };
  });
}

export function getThread(threadId: string) {
  const row = db
    .select({ thread: threads, family: families })
    .from(threads)
    .innerJoin(families, eq(threads.familyId, families.id))
    .where(eq(threads.id, threadId))
    .get();
  if (!row) return null;
  const msgs = db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.createdAt), asc(sql`rowid`))
    .all();
  return { ...row.thread, family: row.family, messages: msgs };
}

export function getMessage(messageId: string): MessageRow | null {
  return db.select().from(messages).where(eq(messages.id, messageId)).get() ?? null;
}

function insertMessage(values: typeof messages.$inferInsert): MessageRow {
  db.insert(messages).values(values).run();
  db.update(threads).set({ lastMessageAt: nowSec() }).where(eq(threads.id, values.threadId)).run();
  return getMessage(values.id)!;
}

/**
 * One parent turn, end to end: store it, answer it from the live snapshot with
 * the whole cross-channel history, store the reply, and flag the thread for
 * the owner when the assistant hands off. The parent message is stored before
 * the model is called so it is never lost if the call fails.
 */
export async function handleParentMessage(
  threadId: string,
  body: string,
  channel: Channel,
): Promise<{ parent: MessageRow; reply: MessageRow; result: AnswerResult }> {
  const thread = getThread(threadId);
  if (!thread) throw new Error("thread not found");

  const history: Turn[] = thread.messages.map((m) => ({
    role: m.role,
    body: m.body,
    topics: (m.meta as { topics?: Topic[] } | null)?.topics,
  }));
  const parent = insertMessage({ id: randomUUID(), threadId, role: "parent", channel, body });

  const live = getLive();
  let result: AnswerResult;
  try {
    result = await answer({
      knowledge: live.data,
      history,
      message: body,
      channel,
      parentFirstName: thread.family.parentFirstName,
    });
  } catch (err) {
    // The parent is still waiting; a silent failure is the worst outcome.
    db.update(threads)
      .set({ status: "needs_attention", attentionReason: "The assistant could not answer this message." })
      .where(eq(threads.id, threadId))
      .run();
    throw err;
  }

  const reply = insertMessage({
    id: randomUUID(),
    threadId,
    role: "assistant",
    channel,
    body: result.reply || "Thanks - I've passed this to the club owner, who will get back to you.",
    escalated: result.escalate,
    snapshotId: live.id,
    usedRules: result.usedRules,
    meta: {
      topics: result.topics,
      usage: result.usage,
      stopReason: result.stopReason,
      latencyMs: result.latencyMs,
      model: result.servedModel,
      status: result.status,
      nextStep: result.nextStep,
    },
  });

  if (result.escalate) {
    db.update(threads)
      .set({ status: "needs_attention", attentionReason: result.escalationReason })
      .where(eq(threads.id, threadId))
      .run();
  } else if (thread.status === "resolved") {
    // A parent writing again reopens a resolved thread.
    db.update(threads).set({ status: "open" }).where(eq(threads.id, threadId)).run();
  }

  return { parent, reply, result };
}

/** The owner writing to the family directly. Answers the thread's open question. */
export function postOwnerReply(threadId: string, body: string, channel: Channel = "text"): MessageRow {
  const msg = insertMessage({ id: randomUUID(), threadId, role: "owner", channel, body });
  db.update(threads)
    .set({ status: "open", attentionReason: null })
    .where(eq(threads.id, threadId))
    .run();
  return msg;
}

export function setThreadStatus(threadId: string, status: ThreadStatus): void {
  db.update(threads)
    .set({ status, ...(status !== "needs_attention" ? { attentionReason: null } : {}) })
    .where(eq(threads.id, threadId))
    .run();
}

/** Conversations waiting on the owner: handed over, or holding a reply the reviewer doubts. */
export function attentionCount(): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(threads)
      .where(
        sql`${threads.status} = 'needs_attention' or exists (select 1 from ${messages} where ${messages.threadId} = ${threads.id} and ${isFlagged})`,
      )
      .get()?.n ?? 0
  );
}
