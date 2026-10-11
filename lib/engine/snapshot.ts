import { createHash } from "node:crypto";

/**
 * Topics are the vocabulary that scopes rules. The previous chatbot started
 * mentioning the late-pickup fee in unrelated conversations because a note was
 * appended to one growing instruction blob; a rule here declares which topics
 * it applies to and is only ever injected for those.
 */
export const TOPICS = [
  "pricing",
  "schedule",
  "registration",
  "trial",
  "siblings",
  "refunds",
  "weather",
  "late_pickup",
  "location",
  "tryouts",
  "camp",
  "injury",
  "payment_dispute",
  "financial_aid",
  "coach_concern",
  "other",
] as const;

export type Topic = (typeof TOPICS)[number];

/** Topics the owner handles personally - the assistant never answers these. */
export const OWNER_ONLY_TOPICS: Topic[] = [
  "injury",
  "payment_dispute",
  "financial_aid",
  "coach_concern",
];

export type Program = {
  id: string;
  name: string;
  ages: string;
  schedule: string;
  price: string;
  /** Free-text the owner can edit, e.g. "the 9:00 class is full, waitlist only". */
  availability?: string;
  notes?: string;
};

export type Policy = {
  id: string;
  name: string;
  topic: Topic;
  detail: string;
};

export type Rule = {
  id: string;
  /** The owner's instruction, in their words. */
  text: string;
  /**
   * `always` rules are injected on every turn (tone, honesty). Scoped rules
   * are injected only when the turn is classified into one of their topics.
   */
  scope: "always" | Topic[];
  source: "owner" | "feedback";
  /** Set when the rule came from correcting a specific assistant turn. */
  createdFromMessageId?: string;
  active: boolean;
};

export type Knowledge = {
  club: { name: string; location: string };
  programs: Program[];
  policies: Policy[];
  rules: Rule[];
};

/**
 * Content hash over the canonical form. Keys are sorted so an unordered
 * re-serialisation of identical knowledge produces an identical hash - without
 * this, every editor save would look like a change and invalidate the cache.
 */
export function hashKnowledge(k: Knowledge): string {
  return createHash("sha256").update(canonical(k)).digest("hex").slice(0, 16);
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/** Rules that apply to a turn: the `always` set plus any scoped to these topics. */
export function rulesForTopics(k: Knowledge, topics: Topic[]): Rule[] {
  return k.rules.filter((r) => {
    if (!r.active) return false;
    if (r.scope === "always") return true;
    return r.scope.some((t) => topics.includes(t));
  });
}

/** Policies relevant to a turn, same scoping principle as rules. */
export function policiesForTopics(k: Knowledge, topics: Topic[]): Policy[] {
  return k.policies.filter((p) => topics.includes(p.topic));
}
