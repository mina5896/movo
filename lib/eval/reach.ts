import { buildPrompt } from "@/lib/engine/prompt";
import type { Knowledge, Topic } from "@/lib/engine/snapshot";

/**
 * Whether a change to the club details reaches a test at all. Each turn of a
 * test sees only the details and rules for its topics; if those come out word
 * for word the same before and after the change, for every turn either side
 * actually took, the change can't have altered the answer. A different score
 * there is the assistant's wording or the grader varying, not harm, and the
 * owner shouldn't be told to hold off because of it.
 *
 * The topic labeller only sees the program names, so a renamed program counts
 * as reaching everything.
 */
export function changeReaches(before: Knowledge, after: Knowledge, turnsTopics: Topic[][]): boolean {
  const names = (k: Knowledge) => k.programs.map((p) => p.name).join("|");
  if (names(before) !== names(after)) return true;
  const text = (k: Knowledge, topics: Topic[]) =>
    buildPrompt(k, topics, "")
      .system.map((b) => b.text)
      .join("\n");
  return turnsTopics.some((topics) => text(before, topics) !== text(after, topics));
}
