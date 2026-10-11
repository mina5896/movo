"use client";

import { useTransition } from "react";

import { runLiveTestsAction, setCaseActiveAction } from "../actions";

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
