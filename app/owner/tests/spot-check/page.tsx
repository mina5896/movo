import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { agreement, nextToReview } from "@/lib/eval/calibration";

import { SpotCheck } from "./client";

async function Body() {
  await connection();
  const item = nextToReview();
  const a = agreement();
  return (
    <div className="flex flex-col gap-4">
      {a.reviewed > 0 && (
        <p className="text-sm">
          So far the grader agreed with you on <span className="font-semibold">{a.agreed} of {a.reviewed}</span> answers.
          {a.graderTooEasy > 0 && ` It passed ${a.graderTooEasy} you wouldn't have.`}
          {a.graderTooHarsh > 0 && ` It failed ${a.graderTooHarsh} you thought were fine.`}
        </p>
      )}
      {item ? (
        <SpotCheck key={item.resultId} item={item} />
      ) : (
        <p className="text-sm text-[var(--muted)]">
          Nothing left to review. <Link href="/owner/tests" className="text-[var(--accent)] underline">Run a check</Link> to get
          more answers.
        </p>
      )}
    </div>
  );
}

export default function SpotCheckPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/owner/tests" className="text-sm text-[var(--muted)] hover:underline">
        ← How it&apos;s doing
      </Link>
      <h1 className="mt-1 text-xl font-semibold">Spot-check the grader</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        The scores come from an automatic grader. Judge a few answers yourself, without seeing its verdict, to see how far
        to trust it. Ten or so is enough to get a feel.
      </p>
      <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
        <Body />
      </Suspense>
    </div>
  );
}
