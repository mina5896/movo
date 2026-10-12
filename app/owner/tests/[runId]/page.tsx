import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import {
  casesById,
  getRun,
  listCases,
  runErrors,
  runProgress,
  runResults,
  type CaseChange,
  type EvalCase,
} from "@/lib/eval/runner";
import { AXIS_LABELS, overallPass, type Axis, type Scores } from "@/lib/eval/types";

import { draftHasChanges, getDraft } from "@/lib/db/snapshots";
import { impactFor } from "@/lib/eval/impact";

import { AutoRefresh } from "../../_components/auto-refresh";
import { ImpactVerdict } from "../../_components/impact";
import { PublishButton } from "../../_components/publish-button";
import { Card, Pill, pct, timeAgo } from "../../_components/ui";

type ResultRow = ReturnType<typeof runResults>[number];

function Verdicts({ scores }: { scores: Scores }) {
  const entries = Object.entries(scores) as [Axis, { pass: boolean; reason: string }][];
  const failed = entries.filter(([, s]) => !s.pass);
  if (failed.length === 0) return <p className="text-xs text-[var(--good)]">Passed every check.</p>;
  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {failed.map(([axis, s]) => (
        <li key={axis} className="text-[var(--danger)]">
          <span className="font-medium">{AXIS_LABELS[axis]}:</span> {s.reason}
        </li>
      ))}
    </ul>
  );
}

function Answer({ r }: { r: ResultRow }) {
  const traj = r.trajectory as { turns?: { parent: string; reply: string; escalated: boolean }[] } | null;
  const turns = traj?.turns ?? [];
  return (
    <div className="flex flex-col gap-1.5">
      {turns.slice(0, -1).map((t, i) => (
        <div key={i} className="text-xs text-[var(--muted)]">
          <p>Parent: {t.parent}</p>
          <p>Assistant: {t.reply}</p>
        </div>
      ))}
      <div className="whitespace-pre-wrap rounded-xl bg-[var(--surface-2)] px-3 py-2 text-sm">{r.reply}</div>
      {r.escalated && <span className="text-xs text-[var(--danger)]">Handed to you</span>}
      <Verdicts scores={r.scores as Scores} />
    </div>
  );
}

function CaseHeader({ c }: { c: EvalCase | undefined }) {
  if (!c) return null;
  return (
    <div className="mb-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{c.title}</span>
        {c.source === "feedback" && <Pill tone="accent">from your correction</Pill>}
      </div>
      <p className="text-sm text-[var(--muted)]">Parent: &ldquo;{c.turns.messages.at(-1)}&rdquo;</p>
      <p className="text-xs text-[var(--muted)]">Expects: {c.expectations.criteria}</p>
    </div>
  );
}

function Comparison({
  changes,
  same,
  liveRows,
  draftRows,
  cases,
}: {
  changes: CaseChange[];
  same: number;
  liveRows: ResultRow[];
  draftRows: ResultRow[];
  cases: Map<string, EvalCase>;
}) {
  const groups: { key: CaseChange["verdict"]; title: string; hint: string; tone: "danger" | "warn" | "good" }[] = [
    { key: "worse", title: "Got worse", hint: "Passed before your change, fails with it - every time we tried.", tone: "danger" },
    { key: "unsteady", title: "Mixed", hint: "Results differ between tries. Worth a look, but may be the assistant varying its wording.", tone: "warn" },
    { key: "better", title: "Got better", hint: "Failed before, passes now.", tone: "good" },
  ];
  const pick = (rows: ResultRow[], id: string) => rows.filter((r) => r.caseId === id);

  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => {
        const items = changes.filter((c) => c.verdict === g.key);
        if (items.length === 0) return null;
        return (
          <section key={g.key}>
            <h2 className="font-semibold">
              {g.title} <Pill tone={g.tone}>{items.length}</Pill>
            </h2>
            <p className="mb-2 text-sm text-[var(--muted)]">{g.hint}</p>
            <div className="flex flex-col gap-3">
              {items.map((ch) => {
                const l = pick(liveRows, ch.caseId);
                const d = pick(draftRows, ch.caseId);
                return (
                  <Card key={ch.caseId} className="p-4">
                    <CaseHeader c={cases.get(ch.caseId)} />
                    {ch.untouched && (
                      <p className="mb-2 text-xs text-[var(--muted)]">
                        Your change doesn&apos;t reach this test: the assistant was given exactly the same details and rules before
                        and after, so the difference is normal variation, not your change.
                      </p>
                    )}
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="mb-1 text-xs font-semibold text-[var(--muted)]">
                          NOW (live) · passed {ch.live?.passes}/{ch.live?.total}
                        </p>
                        {l[0] && <Answer r={l[0]} />}
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-semibold text-[var(--muted)]">
                          WITH YOUR CHANGE · passed {ch.draft?.passes}/{ch.draft?.total}
                        </p>
                        {(d.find((r) => !overallPass(r.scores as Scores)) ?? d[0]) && (
                          <Answer r={d.find((r) => !overallPass(r.scores as Scores)) ?? d[0]} />
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
      {changes.length === 0 && (
        <Card className="p-4 text-sm">
          <span className="font-medium text-[var(--good)]">No answer changed result.</span> All {same} practice conversations scored
          the same before and after.
        </Card>
      )}
      <UnchangedAnswers liveRows={liveRows} draftRows={draftRows} cases={cases} changed={new Set(changes.map((c) => c.caseId))} />
    </div>
  );
}

function UnchangedAnswers({
  liveRows,
  draftRows,
  cases,
  changed,
}: {
  liveRows: ResultRow[];
  draftRows: ResultRow[];
  cases: Map<string, EvalCase>;
  changed: Set<string>;
}) {
  const ids = [...new Set(draftRows.map((r) => r.caseId))].filter((id) => !changed.has(id));
  if (ids.length === 0) return null;
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold">Same result before and after ({ids.length}) - see the wording</summary>
      <div className="mt-3 flex flex-col gap-3">
        {ids.map((id) => {
          const l = liveRows.find((r) => r.caseId === id);
          const d = draftRows.find((r) => r.caseId === id);
          return (
            <Card key={id} className="p-4">
              <CaseHeader c={cases.get(id)} />
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-semibold text-[var(--muted)]">NOW (live)</p>
                  {l && <Answer r={l} />}
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold text-[var(--muted)]">WITH YOUR CHANGE</p>
                  {d && <Answer r={d} />}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </details>
  );
}

function SingleRun({ rows, cases }: { rows: ResultRow[]; cases: Map<string, EvalCase> }) {
  const failing = rows.filter((r) => !overallPass(r.scores as Scores));
  const passing = rows.filter((r) => overallPass(r.scores as Scores));
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-2 font-semibold">
          Needs a look <Pill tone={failing.length ? "danger" : "good"}>{failing.length}</Pill>
        </h2>
        {failing.length === 0 && <p className="text-sm text-[var(--muted)]">Every answer passed.</p>}
        <div className="flex flex-col gap-3">
          {failing.map((r) => (
            <Card key={r.id} className="scroll-mt-20 p-4" id={r.caseId}>
              <CaseHeader c={cases.get(r.caseId)} />
              <Answer r={r} />
            </Card>
          ))}
        </div>
      </section>
      {passing.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">Passed ({passing.length})</summary>
          <div className="mt-3 flex flex-col gap-3">
            {passing.map((r) => (
              <Card key={r.id} className="p-4">
                <CaseHeader c={cases.get(r.caseId)} />
                <Answer r={r} />
              </Card>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

async function RunView({ params }: { params: Promise<{ runId: string }> }) {
  await connection();
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) notFound();

  const baselineId = run.summary?.baselineRunId;
  const baseline = baselineId ? getRun(baselineId) : null;
  const total = listCases({ activeOnly: true }).length;
  const progress = runProgress(run.id);
  const baseProgress = baseline ? runProgress(baseline.id) : null;
  const rows = runResults(run.id);
  const baseRows = baseline ? runResults(baseline.id) : [];
  const errors = runErrors(run.id);
  const cases = casesById([...new Set([...rows, ...baseRows].map((r) => r.caseId))]);
  const running = run.status === "running" || baseline?.status === "running";

  return (
    <div className="flex flex-col gap-5">
      {running && <AutoRefresh every={3000} />}
      <div>
        <Link href={baseline ? "/owner/club" : "/owner/tests"} className="text-sm text-[var(--muted)] hover:underline">
          ← {baseline ? "Back to your changes" : "How it's doing"}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{baseline ? "How your change affects answers" : run.label}</h1>
        <p className="text-sm text-[var(--muted)]">
          Started {timeAgo(run.startedAt)}
          {run.costUsd && ` · cost $${(Number(run.costUsd) + Number(baseline?.costUsd ?? 0)).toFixed(2)}`}
          {run.status === "done" && run.summary && !baseline && ` · ${pct(run.summary.passRate)} passed`}
        </p>
      </div>

      {running && (
        <Card className="p-4 text-sm">
          <p className="font-medium">
            {baseline ? "Replaying every practice conversation on the current version and on your change…" : "Running the practice conversations…"}
          </p>
          <p className="mt-1 text-[var(--muted)]">
            {progress.done + progress.errors + (baseProgress ? baseProgress.done + baseProgress.errors : 0)} answers graded so
            far (about {baseline ? total * 2 : total} to go, plus a few re-tries of anything that changed). This page updates by
            itself.
          </p>
        </Card>
      )}

      {baseline && run.status === "done" && <CheckHeadline snapshotId={run.snapshotId} snapshotHash={run.snapshotHash} />}

      {run.status === "failed" && (
        <Card className="border-[var(--danger)] p-4 text-sm text-[var(--danger)]">
          This check didn&apos;t finish (the server may have restarted). Run it again.
        </Card>
      )}

      {errors.length > 0 && (
        <p className="text-xs text-[var(--warn)]">
          {errors.length} attempt{errors.length > 1 ? "s" : ""} couldn&apos;t be graded (a connection or service problem, not the
          assistant&apos;s answer) and {errors.length > 1 ? "are" : "is"} left out of the score.
        </p>
      )}

      {!running && run.status === "done" && baseline && run.summary?.comparison && (
        <Comparison
          changes={run.summary.comparison.changes}
          same={run.summary.comparison.same}
          liveRows={baseRows}
          draftRows={rows}
          cases={cases}
        />
      )}
      {!running && run.status === "done" && !baseline && <SingleRun rows={rows} cases={cases} />}
    </div>
  );
}

/** The plain verdict, and a publish button while this check still describes the unpublished changes. */
function CheckHeadline({ snapshotId, snapshotHash }: { snapshotId: string; snapshotHash: string }) {
  const draft = getDraft();
  const current = draft?.id === snapshotId && draft.hash === snapshotHash && draftHasChanges();
  const impact = impactFor(snapshotHash);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <ImpactVerdict impact={impact} linked={false} />
      {current && impact.state === "done" ? (
        <div>
          <PublishButton label={draft.label === "Unpublished changes" ? "Updated club details" : draft.label} harmful={impact.worse > 0} />
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          {draft?.id === snapshotId ? "Your changes have been edited since this check." : "These changes have been published or discarded."}
        </p>
      )}
    </Card>
  );
}

export default function RunPage({ params }: PageProps<"/owner/tests/[runId]">) {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
      <RunView params={params} />
    </Suspense>
  );
}
