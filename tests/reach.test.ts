import { describe, expect, it } from "vitest";

import { changeReaches } from "@/lib/eval/reach";
import { SEED_KNOWLEDGE } from "@/lib/seed-knowledge";

const gearRule = {
  ...SEED_KNOWLEDGE,
  rules: [
    ...SEED_KNOWLEDGE.rules,
    {
      id: "fb-gear",
      text: "Shin guards are required at every practice.",
      scope: ["other" as const],
      source: "feedback" as const,
      active: true,
    },
  ],
};

describe("does a change reach a test", () => {
  it("not when no turn's topics bring in the changed rule", () => {
    expect(changeReaches(SEED_KNOWLEDGE, gearRule, [["schedule", "weather"]])).toBe(false);
  });
  it("yes when one turn's topics do", () => {
    expect(changeReaches(SEED_KNOWLEDGE, gearRule, [["schedule"], ["other"]])).toBe(true);
  });
  it("yes for every test when a program is renamed, since topic labelling sees the names", () => {
    const renamed = structuredClone(SEED_KNOWLEDGE);
    renamed.programs[0].name = "Tiny Kicks";
    expect(changeReaches(SEED_KNOWLEDGE, renamed, [["weather"]])).toBe(true);
  });
});
