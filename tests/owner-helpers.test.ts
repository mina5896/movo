import { describe, expect, it } from "vitest";

import { hasBlanks } from "@/lib/blanks";
import { describeChildren, isLead, profileLine, type FamilyProfile } from "@/lib/profile";

describe("blanks in a drafted owner reply", () => {
  it("finds a blank the owner still has to fill in", () => {
    expect(hasBlanks("I can call you [day and time] to talk it through.")).toBe(true);
  });
  it("lets a finished reply through", () => {
    expect(hasBlanks("I can call you Thursday at 4pm.")).toBe(false);
  });
});

const profile = (p: Partial<FamilyProfile>): FamilyProfile => ({
  children: [],
  interestedIn: [],
  stage: "just_asking",
  trial: "",
  phone: "",
  email: "",
  bestTime: "",
  followUp: "",
  at: 0,
  ...p,
});

describe("family card", () => {
  it("names the children with their ages", () => {
    expect(describeChildren([{ name: "Sam", age: "5" }, { name: "Lily", age: "" }])).toBe("Sam (5), Lily");
  });
  it("counts children whose names weren't given", () => {
    expect(describeChildren([{ name: "", age: "5" }, { name: "", age: "7" }])).toBe("2 kids (5, 7)");
  });
  it("reads as one line in the inbox", () => {
    expect(profileLine(profile({ children: [{ name: "Sam", age: "5" }], interestedIn: ["Little Kicks"] }))).toBe(
      "Sam (5) · Little Kicks",
    );
  });
  it("marks families to follow up with", () => {
    expect(isLead(profile({ stage: "wants_trial" }))).toBe(true);
    expect(isLead(profile({ stage: "interested" }))).toBe(false);
  });
});
