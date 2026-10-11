"use client";

import { useTransition } from "react";

import { publishDraftAction } from "../actions";

export function PublishButton({ label, harmful }: { label: string; harmful: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => {
        // window.confirm is used deliberately for the one irreversible-feeling action.
        if (harmful && !window.confirm("Some answers got worse with this change. Publish anyway?")) return;
        start(() => publishDraftAction(label));
      }}
      className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40 ${
        harmful ? "border border-[var(--border)]" : "bg-[var(--accent)] text-white"
      }`}
    >
      {pending ? "Publishing…" : "Publish to parents"}
    </button>
  );
}
