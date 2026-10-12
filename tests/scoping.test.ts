import { describe, expect, it } from "vitest";

import { canonical, hashKnowledge, policiesForTopics, rulesForTopics } from "@/lib/engine/snapshot";
import { SEED_KNOWLEDGE } from "@/lib/seed-knowledge";

describe("topic scoping (the late-pickup leak)", () => {
  it("keeps the late pickup policy out of a question about location", () => {
    const names = policiesForTopics(SEED_KNOWLEDGE, ["location"]).map((p) => p.name);
    expect(names).toEqual(["Location"]);
  });

  it("gives every-conversation rules always, scoped rules only for their topics", () => {
    const ids = (topics: Parameters<typeof rulesForTopics>[1]) => rulesForTopics(SEED_KNOWLEDGE, topics).map((r) => r.id);
    expect(ids(["location"])).not.toContain("no-promised-spots");
    expect(ids(["location"])).toContain("tone");
    expect(ids(["registration"])).toContain("no-promised-spots");
  });

  it("skips rules the owner switched off", () => {
    const k = structuredClone(SEED_KNOWLEDGE);
    k.rules.find((r) => r.id === "tone")!.active = false;
    expect(rulesForTopics(k, ["other"]).map((r) => r.id)).not.toContain("tone");
  });
});

describe("hashKnowledge", () => {
  it("ignores key order, so re-saving unchanged details isn't a change", () => {
    const reverse = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(reverse)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverse(x)]))
          : v;
    const reordered = reverse(SEED_KNOWLEDGE) as typeof SEED_KNOWLEDGE;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(SEED_KNOWLEDGE));
    expect(hashKnowledge(reordered)).toBe(hashKnowledge(SEED_KNOWLEDGE));
    expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
  });

  it("changes when a price changes", () => {
    const k = structuredClone(SEED_KNOWLEDGE);
    k.programs[0].price = "$130 per 8-week session";
    expect(hashKnowledge(k)).not.toBe(hashKnowledge(SEED_KNOWLEDGE));
  });
});
