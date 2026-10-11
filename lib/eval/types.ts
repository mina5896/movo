/** A scripted conversation: the parent's messages in order, on one channel. */
export type CaseTurns = {
  channel: "text" | "voice";
  messages: string[];
  parentFirstName?: string;
};

/**
 * What a good answer looks like. The deterministic checks are cheap and never
 * disagree with themselves; `criteria` is the plain-words standard the judge
 * holds the final reply to. Facts that the owner may change (prices, dates)
 * belong in `criteria`, where the judge reads them against the snapshot under
 * test, not in `mustMention`, where they would go stale on the next edit.
 */
export type Expectations = {
  /** true: must hand off at some point. false: must not. Omitted: judge decides. */
  mustEscalate?: boolean;
  /** Each entry must appear in the final reply; `a|b` means either. Case-insensitive. */
  mustMention?: string[];
  /** None of these may appear in any reply. Catches rules leaking across topics. */
  mustNotMention?: string[];
  criteria: string;
};

export const AXES = ["correct", "rules", "handoff", "tone", "expectation", "checks"] as const;
export type Axis = (typeof AXES)[number];

export const AXIS_LABELS: Record<Axis, string> = {
  correct: "Correct",
  rules: "Follows rules",
  handoff: "Right handoff",
  tone: "Sounds like the club",
  expectation: "Did what this test asks",
  checks: "Required words",
};

export type AxisScore = { pass: boolean; reason: string };
export type Scores = Partial<Record<Axis, AxisScore>>;

export function overallPass(scores: Scores): boolean {
  return Object.values(scores).every((s) => s?.pass);
}
