import type { ImpactStatus } from "@/lib/eval/impact";

/**
 * The before/after check in one plain verdict. The side-by-side answers are a
 * link away for an owner who wants them, but the decision shouldn't need them.
 */
export function ImpactVerdict({ impact, linked = true }: { impact: ImpactStatus; linked?: boolean }) {
  const link = (text: string) =>
    linked && "runId" in impact ? (
      <a href={`/owner/tests/${impact.runId}`} className="text-[var(--accent)] underline">
        {text}
      </a>
    ) : null;

  switch (impact.state) {
    case "none":
      return (
        <p className="text-sm text-[var(--muted)]">
          Not checked yet. A check replays every test conversation on the current version and on your change (about 4
          minutes, under $1).
        </p>
      );
    case "running":
      return (
        <p className="text-sm">
          <span className="font-medium">Checking your change against every test conversation…</span>{" "}
          <span className="text-[var(--muted)]">About 4 minutes. You can leave this page; the result will wait for you.</span>{" "}
          {link("Watch")}
        </p>
      );
    case "failed":
      return <p className="text-sm text-[var(--danger)]">The last check didn&apos;t finish. Run it again.</p>;
    case "done": {
      const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
      if (impact.worse > 0) {
        return (
          <div className="text-sm">
            <p className="font-semibold text-[var(--danger)]">
              Hold on: {plural(impact.worse, "answer", "answers")} got worse with this change.
            </p>
            <p className="text-[var(--muted)]">
              Look at {impact.worse === 1 ? "it" : "them"} before publishing. {link("See what changed")}
            </p>
          </div>
        );
      }
      return (
        <div className="text-sm">
          <p className="font-semibold text-[var(--good)]">✓ Safe to publish.</p>
          <p className="text-[var(--muted)]">
            {impact.better > 0 ? `${plural(impact.better, "answer", "answers")} got better, nothing` : "Nothing"} got worse
            {impact.unsteady > 0 && `, and ${plural(impact.unsteady, "answer", "answers")} varied between tries (normal wording differences)`}
            . {link("See the answers")}
          </p>
        </div>
      );
    }
  }
}
