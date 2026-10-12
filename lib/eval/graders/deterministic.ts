import type { AxisScore, Expectations, Scores } from "../types";

export type Transcript = {
  replies: string[];
  escalatedAny: boolean;
  /** Figures in the final reply that the club details don't support (lib/engine/grounding.ts). */
  unsupported?: string[];
};

/**
 * The checks that don't need a model. They run first and override the judge
 * on the axes they cover: a reply either escalated or it didn't, and a word
 * either appears or it doesn't.
 */
export function deterministicScores(t: Transcript, e: Expectations): Scores {
  const scores: Scores = {};
  const final = (t.replies.at(-1) ?? "").toLowerCase();

  if (e.mustEscalate !== undefined) {
    const pass = t.escalatedAny === e.mustEscalate;
    scores.handoff = {
      pass,
      reason: e.mustEscalate
        ? pass
          ? "Handed this to the owner, as it should."
          : "Should have handed this to the owner, but answered on its own."
        : pass
          ? "Answered without bothering the owner, as it should."
          : "Handed this to the owner when it could have answered.",
    };
  }

  const problems: string[] = [];
  for (const want of e.mustMention ?? []) {
    const options = want.split("|").map((s) => s.trim().toLowerCase());
    if (!options.some((o) => final.includes(o))) problems.push(`didn't mention "${want}"`);
  }
  for (const banned of e.mustNotMention ?? []) {
    const hit = t.replies.find((r) => r.toLowerCase().includes(banned.toLowerCase()));
    if (hit) problems.push(`mentioned "${banned}", which it shouldn't have`);
  }
  for (const f of t.unsupported ?? []) problems.push(`said "${f}", which isn't in the club details`);
  if ((e.mustMention?.length ?? 0) + (e.mustNotMention?.length ?? 0) + (t.unsupported?.length ?? 0) > 0) {
    const score: AxisScore = problems.length
      ? { pass: false, reason: `The reply ${problems.join("; ")}.` }
      : { pass: true, reason: "Included and avoided the right words." };
    scores.checks = score;
  }

  return scores;
}
