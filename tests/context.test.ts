import { describe, expect, it } from "vitest";

import { describeContext, endOfClubDay, upcomingDays } from "@/lib/engine/context";

const TZ = "America/New_York";
// Tuesday, October 13, 2026, 2:00 PM in New York.
const now = new Date("2026-10-13T18:00:00Z");

describe("club time", () => {
  it("ends 'today' at the club's midnight, not the server's", () => {
    expect(new Date(endOfClubDay(now, 0, TZ) * 1000).toISOString()).toBe("2026-10-14T04:00:00.000Z");
    expect(new Date(endOfClubDay(now, 1, TZ) * 1000).toISOString()).toBe("2026-10-15T04:00:00.000Z");
  });

  it("tells the assistant the weekday and date", () => {
    expect(describeContext(now, [], TZ)).toContain("Tuesday, October 13, 2026 at 2:00 PM");
  });

  it("lists notices with when they were posted", () => {
    const text = describeContext(now, [{ text: "Practice cancelled tonight.", createdAt: 1792000000, expiresAt: 1792100000 }], TZ);
    expect(text).toContain("Practice cancelled tonight.");
    expect(text).toContain("posted");
  });

  it("knows the days around today", () => {
    expect(upcomingDays(now, 4, TZ)).toEqual([1012, 1013, 1014, 1015, 1016, 1017]);
  });
});
