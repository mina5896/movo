"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  approveFixAction,
  dismissFixAction,
  proposeFixAction,
  replyAction,
  setStatusAction,
} from "../../actions";

export function ReplyBox({ threadId, status }: { threadId: string; status: string }) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const text = body;
        start(async () => {
          await replyAction(threadId, text);
          setBody("");
        });
      }}
      className="flex flex-col gap-2"
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Reply to the family yourself - they'll see it in the same conversation"
        className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <button
          disabled={pending || !body.trim()}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Send reply
        </button>
        {status !== "resolved" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => start(() => setStatusAction(threadId, "resolved"))}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
          >
            Mark resolved
          </button>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => start(() => setStatusAction(threadId, "needs_attention"))}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
          >
            Reopen
          </button>
        )}
      </div>
    </form>
  );
}

export function CorrectButton({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-[var(--muted)] hover:text-[var(--danger)] hover:underline">
        Something wrong with this reply?
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await proposeFixAction(messageId, note);
          if (r.error) setError(r.error);
          else {
            setOpen(false);
            setNote("");
          }
        });
      }}
      className="mt-2 flex w-full flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
    >
      <label className="text-xs font-medium">What was wrong, or what should it have said? Plain words are fine.</label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        autoFocus
        placeholder={`e.g. "Camp is now June 28 to August 20" or "Don't mention the fee unless they ask about pickup"`}
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
      />
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      <div className="flex gap-2">
        <button disabled={pending || note.trim().length < 3} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-40">
          {pending ? "Working out the fix…" : "Suggest a fix"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm text-[var(--muted)]">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ProposalActions({ feedbackId }: { feedbackId: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        disabled={pending}
        onClick={() => start(() => approveFixAction(feedbackId))}
        className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
      >
        Looks right - add to my changes
      </button>
      <button
        disabled={pending}
        onClick={() => start(() => dismissFixAction(feedbackId))}
        className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] hover:underline"
      >
        Not quite - discard
      </button>
    </div>
  );
}

export function AppliedNote() {
  return (
    <p className="text-xs text-[var(--good)]">
      Added to your unpublished changes, with a test so this can&apos;t come back.{" "}
      <Link href="/owner/club" className="underline">
        Review and publish →
      </Link>
    </p>
  );
}
