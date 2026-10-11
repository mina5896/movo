"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { AXIS_LABELS, type Axis, type Scores } from "@/lib/eval/types";

import { labelAction } from "../../actions";

type Item = {
  resultId: string;
  title: string;
  criteria: string;
  turns: { parent: string; reply: string }[];
  escalated: boolean;
};

export function SpotCheck({ item }: { item: Item }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ graderPass: boolean; agreed: boolean; scores: Scores } | null>(null);
  const [pending, start] = useTransition();

  function label(l: "pass" | "fail") {
    start(async () => setResult(await labelAction(item.resultId, l, note)));
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div>
        <p className="font-medium">{item.title}</p>
        <p className="text-xs text-[var(--muted)]">What this test expects: {item.criteria}</p>
      </div>
      <div className="flex flex-col gap-2">
        {item.turns.map((t, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="self-start rounded-2xl bg-[var(--surface-2)] px-3 py-1.5 text-sm">{t.parent}</div>
            <div className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl bg-[var(--accent-soft)] px-3 py-1.5 text-sm">
              {t.reply}
            </div>
          </div>
        ))}
        {item.escalated && <p className="self-end text-xs text-[var(--danger)]">It handed this to you.</p>}
      </div>

      {!result ? (
        <>
          <p className="text-sm font-medium">Would you be happy if a parent got this answer?</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Why? (optional)"
            className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button onClick={() => label("pass")} disabled={pending} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">
              Yes, that&apos;s fine
            </button>
            <button onClick={() => label("fail")} disabled={pending} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium">
              No, not good enough
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p className={`font-medium ${result.agreed ? "text-[var(--good)]" : "text-[var(--warn)]"}`}>
            {result.agreed
              ? "The grader agreed with you."
              : `The grader disagreed: it ${result.graderPass ? "passed" : "failed"} this answer.`}
          </p>
          <ul className="text-xs text-[var(--muted)]">
            {(Object.entries(result.scores) as [Axis, { pass: boolean; reason: string }][]).map(([a, s]) => (
              <li key={a}>
                {s.pass ? "✓" : "✗"} {AXIS_LABELS[a]}: {s.reason}
              </li>
            ))}
          </ul>
          <button
            onClick={() => {
              setResult(null);
              setNote("");
              router.refresh();
            }}
            className="self-start rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          >
            Next answer
          </button>
        </div>
      )}
    </div>
  );
}
