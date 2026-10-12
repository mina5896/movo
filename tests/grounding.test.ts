import { describe, expect, it } from "vitest";

import { extractFigures, unsupportedFigures } from "@/lib/engine/grounding";
import { SEED_KNOWLEDGE } from "@/lib/seed-knowledge";

const sources = (extra: string[] = []) => ({
  texts: [JSON.stringify(SEED_KNOWLEDGE), ...extra],
  nearbyDays: [1011, 1012, 1013, 1017],
});

describe("extractFigures", () => {
  it("finds prices, times, dates and percentages", () => {
    const f = extractFigures("Little Kicks is $120, Saturdays 10:00-10:45am, from June 21st, 10% off.");
    expect(f.map((x) => x.kind).sort()).toEqual(["date", "money", "percent", "time", "time"]);
  });

  it("reads 9am and 9:00 as the same time", () => {
    const [a] = extractFigures("9am");
    const [b] = extractFigures("9:00");
    expect(a.value).toBe(b.value);
  });
});

describe("unsupportedFigures", () => {
  it("passes a reply that only uses the club's figures", () => {
    const reply = "Hi Sam! Little Kicks is $120 per 8-week session, Saturdays at 9:00 or 10:00am. Camp runs June 21 to August 13.";
    expect(unsupportedFigures(reply, sources())).toEqual([]);
  });

  it("flags an invented price, time and date", () => {
    const reply = "Rec League is $150, practice is at 7pm, and camp starts July 2.";
    expect(unsupportedFigures(reply, sources())).toEqual(["$150", "7pm", "July 2"]);
  });

  it("allows a time one stated duration from a known one, when the reply names it", () => {
    expect(unsupportedFigures("The owner decides two hours before start, so for a 10am class you'll hear by 8am.", sources())).toEqual([]);
    expect(unsupportedFigures("After the first 10 minutes the fee starts, so from 6:25pm.", sources())).toEqual([]);
    // The same time without the duration that explains it is still flagged.
    expect(unsupportedFigures("Rec League practice is at 7pm tonight", sources())).toEqual(["7pm"]);
  });

  it("allows prices worked out from the club's own", () => {
    // Second child 10% off, two weeks of camp, first travel month plus uniform, two Rec children.
    for (const p of ["$216", "$620", "$180", "$456"]) {
      expect(unsupportedFigures(`That comes to ${p}.`, sources())).toEqual([]);
    }
  });

  it("allows figures the parent or a notice gave", () => {
    expect(unsupportedFigures("Yes, the 6:30 start is fine.", sources(["can we come at 6:30?"]))).toEqual([]);
    expect(unsupportedFigures("Fields reopen Oct 20.", sources(["Fields closed until Oct 20."]))).toEqual([]);
  });

  it("allows dates near today, for 'this Saturday'", () => {
    expect(unsupportedFigures("See you this Saturday, October 17!", sources())).toEqual([]);
  });

  it("doesn't let a per-minute fee make every price derivable", () => {
    expect(unsupportedFigures("It's $199 for the season.", sources())).toEqual(["$199"]);
  });
});

describe("worked totals", () => {
  it("accepts a total when the working is shown and right", () => {
    const reply = "First child: 3 x $310 = $930. Second: $310 - $31 = $279 a week, 3 x $279 = $837. Total: $930 + $837 = $1,767.";
    expect(unsupportedFigures(reply, sources())).toEqual([]);
  });

  it("rejects a total when the sum is wrong", () => {
    expect(unsupportedFigures("$930 + $837 = $1,800", sources())).toEqual(["$1,800"]);
  });

  it("rejects working built on an invented price", () => {
    expect(unsupportedFigures("$150 + $240 = $390", sources())).toEqual(["$150", "$390"]);
  });

  it("allows a per-class price and the per-minute fee only in context", () => {
    expect(unsupportedFigures("That's $15 a class.", sources())).toEqual([]);
    expect(unsupportedFigures("If you're 15 minutes late it's $5.", sources())).toEqual([]);
    expect(unsupportedFigures("A uniform is $45.", sources())).toEqual(["$45"]);
  });
});
