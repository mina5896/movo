export type CaseOutcome = { passes: number; total: number; rate: number };

export type CaseChange = {
  caseId: string;
  live: CaseOutcome | null;
  draft: CaseOutcome | null;
  /** worse/better: consistent across the confirming attempts. unsteady: mixed results. */
  verdict: "worse" | "better" | "unsteady";
  /** The change doesn't reach this test (see reach.ts), so any difference is variation, never "worse". */
  untouched?: boolean;
};

/**
 * The verdict for one test from its results on each side. "Worse" needs it to
 * pass at least 2 of 3 tries before and at most 1 of 3 after; anything less
 * clear-cut is "unsteady", so ordinary variation in wording isn't reported as
 * harm. Null means no change.
 */
export function verdict(l: CaseOutcome, d: CaseOutcome): CaseChange["verdict"] | null {
  if (l.rate === d.rate && (l.rate === 0 || l.rate === 1)) return null;
  if (l.rate === d.rate) return "unsteady";
  const worse = d.rate < l.rate;
  const decisive = worse ? d.rate <= 1 / 3 && l.rate >= 2 / 3 : l.rate <= 1 / 3 && d.rate >= 2 / 3;
  return decisive ? (worse ? "worse" : "better") : "unsteady";
}
