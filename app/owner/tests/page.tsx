import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { agreement } from "@/lib/eval/calibration";
import { writingJobs } from "@/lib/eval/generate";
import { casesById, latestLiveCheck, listCases, listRuns, runResults } from "@/lib/eval/runner";
import { AXIS_LABELS, AXES, overallPass, type Scores } from "@/lib/eval/types";
import { reviewStats } from "@/lib/review";

import { AutoRefresh } from "../_components/auto-refresh";
import { Card, Pill, health, pct, timeAgo } from "../_components/ui";
import { CaseToggle, DismissWriting, KeepTests, RemoveTest, RunButton, WriteTests } from "./client";

/** What went wrong, in a few words: the detail is one click away. */
function problemLabel(scores: Scores, escalated: boolean): { label: string; reason: string } {
  const order = ["correct", "rules", "handoff", "expectation", "checks", "tone"] as const;
  const labels: Record<(typeof order)[number], string> = {
    correct: "Said something your details don't say",
    rules: "Didn't follow one of your rules",
    handoff: escalated ? "Passed it to you when it didn't need to" : "Should have passed it to you",
    expectation: "Missed what the parent needed",
    checks: "Got a required detail wrong",
    tone: "Didn't sound like the club",
  };
  for (const axis of order) {
    const s = scores[axis];
    if (s && !s.pass) return { label: labels[axis], reason: s.reason };
  }
  return { label: "", reason: "" };
}

async function Overview() {
  await connection();
  const runs = listRuns(30);
  const cases = listCases();
  const latest = latestLiveCheck();
  const s = latest?.summary;
  const h = s ? health(s.passRate) : null;
  const failing = latest ? runResults(latest.id).filter((r) => !overallPass(r.scores as Scores)) : [];
  const failingCases = casesById(failing.map((r) => r.caseId));
  const waiting = listCases({ pending: true });
  const writing = writingJobs();
  const anyRunning = runs.some((r) => r.status === "running") || writing.some((j) => !j.error);
  const bySource = (src: string) => cases.filter((c) => c.source === src).length;
  const cal = agreement();
  const rev = reviewStats();

  return (
    <div className="flex flex-col gap-6">
      {anyRunning && <AutoRefresh every={4000} />}

      <Card className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          {s && h ? (
            <>
              <p className={`text-2xl font-semibold ${h.tone}`}>{h.label}</p>
              <p className="mt-1 text-[var(--muted)]">
                {Math.round(s.passRate * s.cases)} of {s.cases} practice conversations handled well · checked{" "}
                {timeAgo(latest!.startedAt)}
              </p>
            </>
          ) : (
            <p className="text-[var(--muted)]">
              Not checked yet. A check plays all {cases.filter((c) => c.active).length} practice conversations against the
              assistant and grades every answer.
            </p>
          )}
        </div>
        <RunButton />
      </Card>

      {failing.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Answers to look at ({failing.length})</h2>
          <Card className="divide-y divide-[var(--border)]">
            {failing.map((r) => {
              const c = failingCases.get(r.caseId);
              const p = problemLabel(r.scores as Scores, r.escalated);
              return (
                <details key={r.id} className="group px-4 py-3 text-sm">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">{c?.title ?? r.caseId}</span>
                    <span className="text-[var(--danger)]">{p.label}</span>
                    <span className="ml-auto text-xs text-[var(--muted)] group-open:hidden">Why ▾</span>
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    {c && <p className="text-[var(--muted)]">Parent: &ldquo;{c.turns.messages.at(-1)}&rdquo;</p>}
                    <p>{p.reason}</p>
                    <div className="flex gap-4 text-xs">
                      <Link href={`/owner/tests/${latest!.id}#${r.caseId}`} className="text-[var(--accent)] underline">
                        See the full answer
                      </Link>
                      {c && <CaseToggle caseId={c.id} active={c.active} />}
                    </div>
                  </div>
                </details>
              );
            })}
          </Card>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4 text-sm">
          <h2 className="font-semibold">Do you agree with the grading?</h2>
          <p className="mt-1 text-[var(--muted)]">
            {cal.reviewed > 0 ? `You agreed on ${cal.agreed} of ${cal.reviewed} answers.` : "Not checked yet."}
          </p>
          <Link href="/owner/tests/spot-check" className="mt-2 inline-block text-[var(--accent)] underline">
            Check a few answers
          </Link>
        </Card>
        <Card className="p-4 text-sm">
          <h2 className="font-semibold">Real conversations</h2>
          <p className="mt-1 text-[var(--muted)]">
            {rev.reviewed} {rev.reviewed === 1 ? "reply" : "replies"} double-checked
            {rev.waiting === 0 && rev.reviewed > 0 ? ", none waiting for you." : "."}
          </p>
          {rev.waiting > 0 && (
            <Link href="/owner" className="mt-2 inline-block font-medium text-[var(--warn)] underline">
              {rev.waiting} waiting for you
            </Link>
          )}
        </Card>
      </div>

      <section>
        <h2 className="font-semibold">Practice conversations ({cases.length})</h2>
        <p className="mb-2 text-sm text-[var(--muted)]">
          {bySource("seed")} by hand · {bySource("generated")} by a simulated parent · {bySource("feedback")} from your
          corrections
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
                <span className="text-[var(--muted)]">Writing {j.count} about &ldquo;{j.about}&rdquo;… about a minute.</span>
              )}
            </p>
          ))}
        </Card>
        {waiting.length > 0 && (
          <Card className="mt-3 divide-y divide-[var(--border)]">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <p className="flex-1 font-medium">
                {waiting.length} new {waiting.length === 1 ? "one" : "ones"} to look over
              </p>
              <KeepTests caseIds={waiting.map((c) => c.id)} />
            </div>
            {waiting.map((c) => (
              <CaseRow key={c.id} c={c} action={<RemoveTest caseId={c.id} />} />
            ))}
          </Card>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-[var(--accent)] underline">Show them all</summary>
          <Card className="mt-2 divide-y divide-[var(--border)]">
            {cases.map((c) => (
              <CaseRow key={c.id} c={c} action={<CaseToggle caseId={c.id} active={c.active} />} />
            ))}
          </Card>
        </details>
      </section>

      <details>
        <summary className="cursor-pointer text-sm font-semibold">Details: scores by area and past checks</summary>
        <div className="mt-3 flex flex-col gap-4">
          {s && (
            <div className="flex flex-wrap gap-2">
              {AXES.map((a) => {
                const x = s.axes[a];
                if (!x) return null;
                const rate = x.pass / x.total;
                return (
                  <Pill key={a} tone={rate === 1 ? "good" : rate >= 0.8 ? "warn" : "danger"}>
                    {AXIS_LABELS[a]}: {x.pass}/{x.total}
                  </Pill>
                );
              })}
            </div>
          )}
          <Card className="divide-y divide-[var(--border)]">
            {runs.map((r) => (
              <Link key={r.id} href={`/owner/tests/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--surface-2)]">
                <span className="font-medium">{r.label}</span>
                {r.status === "running" && <Pill tone="accent">running</Pill>}
                {r.status === "failed" && <Pill tone="danger">didn&apos;t finish</Pill>}
                {r.status === "done" && r.summary && <span className="text-[var(--muted)]">{pct(r.summary.passRate)} passed</span>}
                <span className="ml-auto text-xs text-[var(--muted)]">
                  {r.costUsd ? `$${Number(r.costUsd).toFixed(2)} · ` : ""}
                  {timeAgo(r.startedAt)}
                </span>
              </Link>
            ))}
          </Card>
        </div>
      </details>
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
      <p className="mb-4 text-sm text-[var(--muted)]">Practice conversations, graded on every answer.</p>
      <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
        <Overview />
      </Suspense>
    </div>
  );
}
