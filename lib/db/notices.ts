import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";

import type { Notice } from "@/lib/engine/context";

import { db } from "./index";
import { notices } from "./schema";

export type NoticeRow = typeof notices.$inferSelect;

const nowSec = () => Math.floor(Date.now() / 1000);

/** What the assistant is told right now: posted, not removed, not expired. */
export function activeNotices(at = new Date()): NoticeRow[] {
  return db
    .select()
    .from(notices)
    .where(and(isNull(notices.removedAt), gt(notices.expiresAt, Math.floor(at.getTime() / 1000))))
    .orderBy(desc(notices.createdAt))
    .all();
}

export function toNotice(n: NoticeRow): Notice {
  return { text: n.text, createdAt: n.createdAt, expiresAt: n.expiresAt };
}

/** The last few that ended, so the owner can see a notice did go away. */
export function recentlyEnded(limit = 5): NoticeRow[] {
  const t = nowSec();
  return db
    .select()
    .from(notices)
    .orderBy(desc(notices.createdAt))
    .limit(30)
    .all()
    .filter((n) => n.removedAt !== null || n.expiresAt <= t)
    .slice(0, limit);
}

export function addNotice(text: string, expiresAt: number): NoticeRow {
  const id = randomUUID();
  db.insert(notices).values({ id, text, expiresAt }).run();
  return db.select().from(notices).where(eq(notices.id, id)).get()!;
}

export function removeNotice(id: string): void {
  db.update(notices).set({ removedAt: nowSec() }).where(eq(notices.id, id)).run();
}
