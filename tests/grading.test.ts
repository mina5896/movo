import { describe, expect, it } from "vitest";

import { deterministicScores } from "@/lib/eval/graders/deterministic";
import { overallPass } from "@/lib/eval/types";
import { verdict } from "@/lib/eval/verdict";

const o = (passes: number, total = 3) => ({ passes, total, rate: passes / total });

describe("before/after verdict", () => {
  it("calls it worse only when chance can't explain it", () => {
    expect(verdict(o(3), o(0))).toBe("worse");
    expect(verdict(o(2), o(1))).toBe("unsteady");
    expect(verdict(o(3), o(2))).toBe("unsteady");
  });

  it("weighs a test's record on the current version", () => {
    // Passed every one of 10 earlier tries: failing 2 of 3 now isn't chance.
    expect(verdict(o(3), o(1), o(10, 10))).toBe("worse");
    // Fails a quarter of the time anyway: failing 3 of 3 can be chance.
    expect(verdict(o(3), o(0), o(9, 12))).toBe("unsteady");
  });

  it("calls it better the same way", () => {
    expect(verdict(o(0), o(3))).toBe("better");
    expect(verdict(o(1), o(2))).toBe("unsteady");
  });

  it("reports no change when both sides agree every time", () => {
    expect(verdict(o(1, 1), o(1, 1))).toBeNull();
    expect(verdict(o(0, 1), o(0, 1))).toBeNull();
    expect(verdict(o(2), o(2))).toBe("unsteady");
  });
});

describe("deterministic checks", () => {
  it("overrides on handoff", () => {
    const s = deterministicScores({ replies: ["ok"], escalatedAny: false }, { mustEscalate: true, criteria: "" });
    expect(s.handoff?.pass).toBe(false);
  });

  it("catches a banned phrase in any reply, case-insensitively", () => {
    const s = deterministicScores(
      { replies: ["Fields are at 400 River Road. Late Pickup is $1/min."], escalatedAny: false },
      { mustNotMention: ["late pickup"], criteria: "" },
    );
    expect(s.checks?.pass).toBe(false);
  });

  it("fails a reply with a figure the club details don't support", () => {
    const s = deterministicScores({ replies: ["It's $150."], escalatedAny: false, unsupported: ["$150"] }, { criteria: "" });
    expect(overallPass(s)).toBe(false);
  });

  it("passes a clean reply", () => {
    const s = deterministicScores({ replies: ["Hi!"], escalatedAny: false, unsupported: [] }, { mustEscalate: false, criteria: "" });
    expect(overallPass(s)).toBe(true);
  });
});
