import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";

import { hashKnowledge, type Knowledge } from "@/lib/engine/snapshot";

import { db } from "./index";
import { snapshots } from "./schema";

export type SnapshotRow = typeof snapshots.$inferSelect & { data: Knowledge };

export function getLive(): SnapshotRow {
  const row = db.select().from(snapshots).where(eq(snapshots.status, "live")).get();
  if (!row) throw new Error("no live snapshot - run `npm run seed`");
  return row as SnapshotRow;
}

export function getDraft(): SnapshotRow | null {
  const row = db
    .select()
    .from(snapshots)
    .where(eq(snapshots.status, "draft"))
    .orderBy(desc(snapshots.createdAt))
    .get();
  return (row as SnapshotRow) ?? null;
}

export function getById(id: string): SnapshotRow | null {
  const row = db.select().from(snapshots).where(eq(snapshots.id, id)).get();
  return (row as SnapshotRow) ?? null;
}

/**
 * The owner's edits land in a draft, never on the snapshot parents are being
 * served. One draft at a time: the owner is one person, and a single draft
 * keeps "what am I about to publish" unambiguous.
 */
export function getOrCreateDraft(): SnapshotRow {
  const existing = getDraft();
  if (existing) return existing;

  const live = getLive();
  const id = randomUUID();
  db.insert(snapshots)
    .values({
      id,
      hash: live.hash,
      status: "draft",
      label: "Unpublished changes",
      data: live.data,
      basedOnId: live.id,
    })
    .run();
  return getById(id)!;
}

export function saveDraft(data: Knowledge, label?: string): SnapshotRow {
  const draft = getOrCreateDraft();
  db.update(snapshots)
    .set({ data, hash: hashKnowledge(data), ...(label ? { label } : {}) })
    .where(eq(snapshots.id, draft.id))
    .run();
  return getById(draft.id)!;
}

/**
 * Archived rather than deleted: a check of the draft still names it, and its
 * results should stay readable.
 */
export function discardDraft(): void {
  const draft = getDraft();
  if (draft) {
    db.update(snapshots)
      .set({ status: "archived", label: `Discarded: ${draft.label}` })
      .where(eq(snapshots.id, draft.id))
      .run();
  }
}

/** True when the draft's knowledge differs from live - cheap, via content hash. */
export function draftHasChanges(): boolean {
  const draft = getDraft();
  if (!draft) return false;
  return draft.hash !== getLive().hash;
}

/**
 * Promotes the draft to live. The outgoing live snapshot is archived rather
 * than deleted, so an eval run from last week still names knowledge that can
 * be read back, and a bad publish can be rolled forward from a known state.
 */
export function publishDraft(label: string): SnapshotRow {
  const draft = getDraft();
  if (!draft) throw new Error("nothing to publish");
  const live = getLive();
  const ts = Math.floor(Date.now() / 1000);

  db.transaction((tx) => {
    tx.update(snapshots).set({ status: "archived" }).where(eq(snapshots.id, live.id)).run();
    tx.update(snapshots)
      .set({ status: "live", label, publishedAt: ts })
      .where(eq(snapshots.id, draft.id))
      .run();
  });

  return getById(draft.id)!;
}

/** Versions that were live once. Discarded drafts are archived too but were never published. */
export function history(limit = 20): SnapshotRow[] {
  return db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.status, "archived"), isNotNull(snapshots.publishedAt)))
    .orderBy(desc(snapshots.publishedAt))
    .limit(limit)
    .all() as SnapshotRow[];
}
