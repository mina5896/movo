/** What a family has told the club, and how it reads to the owner. Pure, so it can be tested without a database. */

export const STAGES = ["just_asking", "interested", "wants_trial", "ready_to_register", "member"] as const;
export type Stage = (typeof STAGES)[number];

export type FamilyProfile = {
  children: { name: string; age: string }[];
  interestedIn: string[];
  stage: Stage;
  trial: string;
  phone: string;
  email: string;
  bestTime: string;
  followUp: string;
  costUsd?: number;
  at: number;
};

export function getProfile(raw: unknown): FamilyProfile | null {
  return (raw as FamilyProfile | null) ?? null;
}

const STAGE_LABEL: Record<Stage, string> = {
  just_asking: "just asking",
  interested: "interested",
  wants_trial: "wants a trial",
  ready_to_register: "ready to sign up",
  member: "already a member",
};
export const stageLabel = (s: Stage) => STAGE_LABEL[s];

/** "Sam (5), Lily (7)" - or "2 kids" when no names were given. */
export function describeChildren(children: FamilyProfile["children"]): string {
  if (children.length === 0) return "";
  if (children.every((c) => !c.name)) {
    const ages = children.map((c) => c.age).filter(Boolean);
    return `${children.length} ${children.length === 1 ? "child" : "kids"}${ages.length ? ` (${ages.join(", ")})` : ""}`;
  }
  return children.map((c) => (c.name ? `${c.name}${c.age ? ` (${c.age})` : ""}` : c.age ? `a ${c.age}-year-old` : "a child")).join(", ");
}

/** One line for the inbox: "Sam (5) · Little Kicks". The stage shows as a pill beside it. */
export function profileLine(p: FamilyProfile): string {
  return [describeChildren(p.children), p.interestedIn.join(", ")].filter(Boolean).join(" · ");
}

/** A family the owner may want to follow up with. */
export const isLead = (p: FamilyProfile | null) => p?.stage === "wants_trial" || p?.stage === "ready_to_register";
