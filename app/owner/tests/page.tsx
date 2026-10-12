import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { agreement } from "@/lib/eval/calibration";
import { writingJobs } from "@/lib/eval/generate";
import { listCases, listRuns } from "@/lib/eval/runner";
import { AXIS_LABELS, AXES } from "@/lib/eval/types";
import { reviewStats } from "@/lib/review";

import { AutoRefresh } from "../_components/auto-refresh";
import { Card, Pill, pct, timeAgo } from "../_components/ui";
import { CaseToggle, DismissWriting, KeepTests, RemoveTest, RunButton, WriteTests } from "./client";

async function Overview() {
  await connection();
  const runs = listRuns(30);
  const cases = listCases();
  const latestLive = runs.find((r) => r.status === "done" && !r.summary?.baselineRunId && r.label !== "Live (before)") ??
    runs.find((r) => r.status === "done" && r.label === "Live (before)");
  const waiting = listCases({ pending: true });
  const writing = writingJobs();
  const anyRunning = runs.some((r) => r.status === "running") || writing.some((j) => !j.error);
  const bySource = (s: string) => cases.filter((c) => c.source === s).length;
  const cal = agreement();
  const rev = reviewStats();

  return (
    <div className="flex flex-col gap-6">
      {anyRunning && <AutoRefresh every={4000} />}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Latest check</h2>
            {latestLive?.summary ? (
              <>
                <p className="mt-1 text-3xl font-semibold">
                  {pct(latestLive.summary.passRate)}
                  <span className="ml-2 text-sm font-normal text-[var(--muted)]">
                    of {latestLive.summary.cases} test conversations fully passed · {timeAgo(latestLive.startedAt)}
                  </span>
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {AXES.map((a) => {
                    const s = latestLive.summary!.axes[a];
                    if (!s) return null;
                    const rate = s.pass / s.total;
                    return (
                      <Pill key={a} tone={rate === 1 ? "good" : rate >= 0.8 ? "warn" : "danger"}>
                        {AXIS_LABELS[a]}: {s.pass}/{s.total}
                      </Pill>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-sm">
                  <Link href={`/owner/tests/${latestLive.id}`} className="text-[var(--accent)] underline">
                    See every answer →
                  </Link>
                  <Link href="/owner/tests/spot-check" className="text-[var(--accent)] underline">
                    Spot-check the grader →
                  </Link>
                  <span className="text-[var(--muted)]">
                    {cal.reviewed > 0
                      ? `Grader agreed with you on ${cal.agreed} of ${cal.reviewed} answers you checked.`
                      : "You haven't spot-checked the grader yet."}
                  </span>
                </div>
              </>
            ) : (
              <p className="mt-1 text-sm text-[var(--muted)]">
                No checks yet. A check plays all {cases.filter((c) => c.active).length} test conversations against the assistant and
                grades each answer.
              </p>
            )}
          </div>
          <RunButton />
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">Real conversations</h2>
        <p className="mt-1 text-sm">
          {rev.reviewed === 0 ? (
            <span className="text-[var(--muted)]">No replies to parents double-checked yet.</span>
          ) : (
            <>
              {rev.reviewed} {rev.reviewed === 1 ? "reply" : "replies"} to parents double-checked.{" "}
              {rev.waiting > 0 ? (
                <Link href="/owner" className="font-medium text-[var(--warn)] underline">
                  {rev.waiting} waiting for you to look at
                </Link>
              ) : (
                <span className="text-[var(--good)]">None waiting for you.</span>
              )}
            </>
          )}
        </p>
        {rev.corrected + rev.dismissed > 0 && (
          <p className="mt-1 text-sm text-[var(--muted)]">
            Of the replies it flagged, you corrected {rev.corrected} and said {rev.dismissed} {rev.dismissed === 1 ? "was" : "were"}{" "}
            fine.
          </p>
        )}
      </Card>

      <section>
        <h2 className="mb-2 font-semibold">Past checks</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">None yet.</p>
        ) : (
          <Card className="divide-y divide-[var(--border)]">
            {runs.map((r) => (
              <Link key={r.id} href={`/owner/tests/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--surface-2)]">
                <span className="font-medium">{r.label}</span>
                {r.status === "running" && <Pill tone="accent">running</Pill>}
                {r.status === "failed" && <Pill tone="danger">didn&apos;t finish</Pill>}
                {r.summary?.comparison && (
                  <Pill tone={r.summary.comparison.changes.some((c) => c.verdict === "worse") ? "danger" : "good"}>
                    {r.summary.comparison.changes.filter((c) => c.verdict === "worse").length} worse ·{" "}
                    {r.summary.comparison.changes.filter((c) => c.verdict === "better").length} better
                  </Pill>
                )}
                {r.status === "done" && r.summary && <span className="text-[var(--muted)]">{pct(r.summary.passRate)} passed</span>}
                <span className="ml-auto text-xs text-[var(--muted)]">
                  {r.costUsd ? `$${Number(r.costUsd).toFixed(2)} · ` : ""}
                  {timeAgo(r.startedAt)}
                </span>
              </Link>
            ))}
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Add test conversations</h2>
        <p className="mb-2 text-sm text-[var(--muted)]">
          A simulated parent writes them and talks to the assistant, then a separate step writes what a good answer
          looks like from your club details. You look them over before they count.
        </p>
        <Card className="flex flex-col gap-3 p-4">
          <WriteTests />
          {writing.map((j) => (
            <p key={j.id} className="text-sm">
              {j.error ? (
                <span className="text-[var(--danger)]">
                  {j.error} <DismissWriting jobId={j.id} />
                </span>
              ) : (
                <span className="text-[var(--muted)]">
                  Writing {j.count} tests about &ldquo;{j.about}&rdquo;… about a minute.
                </span>
              )}
            </p>
          ))}
        </Card>
        {waiting.length > 0 && (
          <Card className="mt-3 divide-y divide-[var(--border)]">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <p className="font-medium">
                  {waiting.length} new {waiting.length === 1 ? "test" : "tests"} to look over
                </p>
                <p className="text-sm text-[var(--muted)]">
                  Remove any that expect the wrong thing. The rest join every check from now on.
                </p>
              </div>
              <KeepTests caseIds={waiting.map((c) => c.id)} />
            </div>
            {waiting.map((c) => (
              <CaseRow key={c.id} c={c} action={<RemoveTest caseId={c.id} />} />
            ))}
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-1 font-semibold">Test conversations ({cases.length})</h2>
        <p className="mb-2 text-sm text-[var(--muted)]">
          {bySource("seed")} written by hand, {bySource("generated")} by a simulated parent, and {bySource("feedback")} from
          your corrections. Every correction adds one, so the same mistake is caught if it ever comes back.
        </p>
        <details className="group">
          <summary className="mb-2 cursor-pointer text-sm text-[var(--accent)] underline">Show them all</summary>
          <Card className="divide-y divide-[var(--border)]">
            {cases.map((c) => (
              <CaseRow key={c.id} c={c} action={<CaseToggle caseId={c.id} active={c.active} />} />
            ))}
          </Card>
        </details>
      </section>
    </div>
  );
}

function CaseRow({ c, action }: { c: ReturnType<typeof listCases>[number]; action: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-0.5 px-4 py-2.5 text-sm ${c.active || c.pending ? "" : "opacity-50"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{c.title}</span>
        {c.source === "feedback" && <Pill tone="accent">from your correction</Pill>}
        {c.turns.channel === "voice" && <Pill>phone call</Pill>}
        {c.expectations.mustEscalate === true && <Pill>should hand to you</Pill>}
        {c.expectations.mustEscalate === false && <Pill>shouldn&apos;t need you</Pill>}
        <span className="ml-auto">{action}</span>
      </div>
      <span className="text-[var(--muted)]">
        {c.turns.parentFirstName ?? "Parent"}: &ldquo;{c.turns.messages.join(" → ")}&rdquo;
      </span>
      <span className="text-xs text-[var(--muted)]">Expects: {c.expectations.criteria}</span>
    </div>
  );
}

export default function TestsPage() {
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">How it&apos;s doing</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        A set of test conversations, each graded on whether the answer is correct, follows your rules, hands the right
        things to you, and sounds like the club.
      </p>
      <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
        <Overview />
      </Suspense>
    </div>
  );
}
