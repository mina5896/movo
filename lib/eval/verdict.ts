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

/** How unlikely a difference must be by chance before a test is called worse or better. */
const CHANCE = 0.01;

/** P(X <= k) for X ~ Binomial(n, p). */
function atMost(k: number, n: number, p: number): number {
  let sum = 0;
  let c = 1;
  for (let i = 0; i <= n; i++) {
    if (i > 0) c = (c * (n - i + 1)) / i;
    if (i <= k) sum += c * p ** i * (1 - p) ** (n - i);
  }
  return sum;
}

/**
 * The verdict for one test from its results on each side. With a hundred
 * tests, some of which pass only most of the time, a few will come out worse
 * after any change by chance alone - found when a camp date change "made" three
 * Little Kicks tests worse. So a test is called worse only when its result
 * after the change would happen less than 1 time in 100 by chance, given how
 * often it passes on the current version (`before`: every try on record, not
 * just this check's). Better is judged the same way. Anything else that
 * differs is "unsteady". Null means no change.
 */
export function verdict(l: CaseOutcome, d: CaseOutcome, before: CaseOutcome = l): CaseChange["verdict"] | null {
  if (l.rate === d.rate && (l.rate === 0 || l.rate === 1)) return null;
  if (l.rate === d.rate) return "unsteady";
  // Nudged toward even, so a short record isn't taken as certainty.
  const p = (before.passes + 0.5) / (before.total + 1);
  if (d.rate < l.rate && atMost(d.passes, d.total, p) < CHANCE) return "worse";
  if (d.rate > l.rate && 1 - atMost(d.passes - 1, d.total, p) < CHANCE) return "better";
  return "unsteady";
}
