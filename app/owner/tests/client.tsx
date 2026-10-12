"use client";

import { useState, useTransition } from "react";

import {
  dismissWritingAction,
  keepTestsAction,
  removeTestAction,
  runLiveTestsAction,
  setCaseActiveAction,
  writeTestsAction,
} from "../actions";

export function RunButton() {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(() => runLiveTestsAction())}
      disabled={pending}
      className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
    >
      {pending ? "Starting…" : "Check the live assistant now"}
    </button>
  );
}

export function CaseToggle({ caseId, active }: { caseId: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => start(() => setCaseActiveAction(caseId, !active))}
      className="text-xs text-[var(--muted)] hover:underline"
    >
      {active ? "Turn off" : "Turn on"}
    </button>
  );
}

export function WriteTests() {
  const [about, setAbout] = useState("");
  const [count, setCount] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await writeTestsAction(about, count);
          setError(r.error ?? null);
          if (!r.error) setAbout("");
        });
      }}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <span>Write</span>
      <select
        value={count}
        onChange={(e) => setCount(Number(e.target.value))}
        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5"
      >
        {[3, 5, 10, 20].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <span>tests about</span>
      <input
        value={about}
        onChange={(e) => setAbout(e.target.value)}
        placeholder="refunds, upset parents, phone calls…"
        className="min-w-56 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5"
      />
      <button
        disabled={pending || about.trim().length < 2}
        className="rounded-lg bg-[var(--accent)] px-4 py-1.5 font-medium text-white disabled:opacity-40"
      >
        {pending ? "Starting…" : "Write them"}
      </button>
      {error && <p className="w-full text-[var(--danger)]">{error}</p>}
    </form>
  );
}

export function KeepTests({ caseIds }: { caseIds: string[] }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => start(() => keepTestsAction(caseIds))}
      className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
    >
      {pending ? "Keeping…" : caseIds.length === 1 ? "Keep it" : `Keep all ${caseIds.length}`}
    </button>
  );
}

export function RemoveTest({ caseId }: { caseId: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => start(() => removeTestAction(caseId))} className="text-xs text-[var(--muted)] hover:underline">
      Remove
    </button>
  );
}

export function DismissWriting({ jobId }: { jobId: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => start(() => dismissWritingAction(jobId))} className="text-xs text-[var(--muted)] hover:underline">
      Dismiss
    </button>
  );
}
