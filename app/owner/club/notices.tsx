"use client";

import { useState, useTransition } from "react";

import { addNoticeAction, removeNoticeAction } from "../actions";

const PRESETS = [
  "Practice is ON tonight as normal.",
  "Tonight's practice is CANCELLED because of the weather. Families have been texted.",
  "The fields are closed today.",
];

export function NoticeForm() {
  const [text, setText] = useState("");
  const [until, setUntil] = useState<"today" | "tomorrow" | "week">("today");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await addNoticeAction(text, until);
          if (r.error) setError(r.error);
          else setText("");
        });
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setText(p)}
            className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            {p.split(" ").slice(0, 4).join(" ")}…
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="e.g. Rec League practice tonight is cancelled because of the rain. Little Kicks on Saturday is still on."
        className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
      />
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-[var(--muted)]">Show until</span>
        <select
          value={until}
          onChange={(e) => setUntil(e.target.value as typeof until)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5"
        >
          <option value="today">the end of today</option>
          <option value="tomorrow">the end of tomorrow</option>
          <option value="week">a week from today</option>
        </select>
        <button
          disabled={pending || text.trim().length < 3}
          className="rounded-lg bg-[var(--accent)] px-4 py-1.5 font-medium text-white disabled:opacity-40"
        >
          Post now
        </button>
      </div>
    </form>
  );
}

export function RemoveNotice({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => start(() => removeNoticeAction(id))}
      className="text-xs text-[var(--muted)] hover:text-[var(--danger)] disabled:opacity-40"
    >
      Take down
    </button>
  );
}
