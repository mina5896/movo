"use client";

import { useState, useTransition } from "react";

import { hasBlanks } from "@/lib/blanks";

import {
  approveFixAction,
  dismissFixAction,
  dismissReviewAction,
  proposeFixAction,
  replyAction,
  setStatusAction,
} from "../../actions";

export function ReplyBox({
  threadId,
  status,
  draft,
}: {
  threadId: string;
  status: string;
  /** A reply drafted from the club details when the assistant handed this over. */
  draft?: { body: string; unsure: string[] } | null;
}) {
  const [body, setBody] = useState("");
  const [usedDraft, setUsedDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const blanks = hasBlanks(body);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const text = body;
        setError(null);
        start(async () => {
          const r = await replyAction(threadId, text);
          if (r.error) setError(r.error);
          else setBody("");
        });
      }}
      className="flex flex-col gap-2"
    >
      {draft && !usedDraft && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] p-3 text-sm">
          <p className="text-xs font-medium text-[var(--muted)]">Suggested reply, from your club details</p>
          <p className="mt-1 whitespace-pre-wrap">{draft.body}</p>
          {draft.unsure.length > 0 && (
            <ul className="mt-2 list-disc pl-4 text-xs text-[var(--muted)]">
              {draft.unsure.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              setBody(draft.body);
              setUsedDraft(true);
            }}
            className="mt-2 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white"
          >
            Use this draft
          </button>
        </div>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={usedDraft ? 5 : 2}
        placeholder="Reply to the family yourself - they'll see it in the same conversation"
        className="rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
      />
      {blanks && <p className="text-xs text-[var(--warn)]">Fill in the parts in [square brackets] before sending.</p>}
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          disabled={pending || !body.trim() || blanks}
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
            Mark as done
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

export function CorrectButton({
  messageId,
  initialNote = "",
  defaultOpen = false,
  onCancel,
}: {
  messageId: string;
  initialNote?: string;
  defaultOpen?: boolean;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [note, setNote] = useState(initialNote);
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
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onCancel?.();
          }}
          className="px-3 py-1.5 text-sm text-[var(--muted)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ProposalActions({
  feedbackId,
  approveLabel = "Looks right - check it",
  dismissLabel = "Not quite - discard",
}: {
  feedbackId: string;
  approveLabel?: string;
  dismissLabel?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        disabled={pending}
        onClick={() => start(() => approveFixAction(feedbackId))}
        className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
      >
        {pending ? "Starting the check…" : approveLabel}
      </button>
      <button
        disabled={pending}
        onClick={() => start(() => dismissFixAction(feedbackId))}
        className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted)] hover:underline"
      >
        {dismissLabel}
      </button>
    </div>
  );
}

/**
 * A reply the reviewer doubts. The owner either agrees and corrects it, starting
 * from the reviewer's suggested wording, or says it's fine.
 */
export function ReviewFlag({ messageId, concern, suggestion }: { messageId: string; concern: string; suggestion?: string }) {
  const [fixing, setFixing] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="w-full rounded-xl border border-[var(--warn)] bg-[var(--warn-soft)] p-3 text-left text-sm">
      <p>
        <span className="font-medium">This reply may be wrong.</span> {concern}
      </p>
      {fixing ? (
        <CorrectButton messageId={messageId} initialNote={suggestion ?? ""} defaultOpen onCancel={() => setFixing(false)} />
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => setFixing(true)}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white"
          >
            Fix it
          </button>
          <button
            disabled={pending}
            onClick={() => start(() => dismissReviewAction(messageId))}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-40"
          >
            It&apos;s fine
          </button>
        </div>
      )}
    </div>
  );
}
