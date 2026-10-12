/**
 * A check in code, before a reply is sent, that every price, time and date in
 * it comes from somewhere the assistant was given: the club details, the
 * owner's notices, today's date, or the conversation itself. It can't be
 * talked out of it and costs nothing, which matters because an invented price
 * or date is the failure the owner fears most.
 *
 * It only understands figures, not meaning. A reply can still be wrong in
 * words; that is what the reviewer and the tests are for.
 */

export type FigureKind = "money" | "time" | "date" | "percent";
export type Figure = { kind: FigureKind; text: string; value: number };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const monthIndex = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

/** Prices, clock times, calendar dates and percentages mentioned in a piece of text. */
export function extractFigures(text: string): Figure[] {
  const out: Figure[] = [];
  const t = text.replace(/[‐-―]/g, "-");

  for (const m of t.matchAll(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)) {
    out.push({ kind: "money", text: m[0], value: Number(m[1].replace(/,/g, "")) });
  }

  // Clock times are compared on a 12-hour dial: source ranges like "9:00-9:45am"
  // only say am once, and the risk being guarded is an invented hour, not am/pm.
  const clock = (h: number, min: number) => (h % 12) * 60 + min;
  for (const m of t.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b\.?/gi)) {
    out.push({ kind: "time", text: m[0].trim(), value: clock(Number(m[1]), Number(m[2] ?? 0)) });
  }
  for (const m of t.matchAll(/\b(\d{1,2}):(\d{2})\b(?!\s*[ap]\.?\s?m\b)/gi)) {
    out.push({ kind: "time", text: m[0], value: clock(Number(m[1]), Number(m[2])) });
  }

  for (const m of t.matchAll(new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi"))) {
    out.push({ kind: "date", text: m[0], value: monthIndex(m[1]) * 100 + Number(m[2]) });
  }
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`, "gi"))) {
    out.push({ kind: "date", text: m[0], value: monthIndex(m[2]) * 100 + Number(m[1]) });
  }

  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s?%/g)) {
    out.push({ kind: "percent", text: m[0], value: Number(m[1]) });
  }
  return out;
}

/**
 * Prices the assistant may work out in one step from the club's own: several
 * weeks or months, a sibling's 10% off (and the 10% itself), a per-class
 * price, a family total at the sibling rate, a first month plus the uniform.
 * Kept narrow on purpose: the wider this set, the more invented prices slip
 * through as "derivable". Longer sums are accepted only when the reply shows
 * the working (see `shownWorking`).
 */
function derivablePrices(base: number[], perMinute: boolean): number[] {
  const out = new Set<number>();
  const units: number[] = [];
  for (const b of base) {
    if (b <= 10) {
      // A per-minute fee: only when the reply is about minutes late, and never
      // summed with anything - otherwise every small amount would pass.
      if (perMinute) for (let n = 1; n <= 60; n++) out.add(b * n);
      out.add(b);
      continue;
    }
    units.push(b, b * 0.9);
    out.add(b * 0.1);
    for (let n = 1; n <= 12; n++) {
      out.add(b * n);
      out.add(b * 0.9 * n);
      out.add(b / n);
    }
    for (let n = 2; n <= 5; n++) out.add(b * (1 + 0.9 * (n - 1)));
  }
  for (let i = 0; i < units.length; i++) for (let j = i; j < units.length; j++) out.add(units[i] + units[j]);
  return [...out].map((v) => Math.round(v * 100) / 100);
}

const NUM = String.raw`\$?\s?\d[\d,]*(?:\.\d+)?`;
const OP = String.raw`\s*(?:[x×*+/-]|times|plus|minus)\s*`;
const EXPRESSION = new RegExp(String.raw`((?:${NUM}${OP})+${NUM})\s*=\s*\$?\s?(\d[\d,]*(?:\.\d+)?)`, "gi");

const toNumber = (s: string) => Number(s.replace(/[$,\s]/g, ""));

/**
 * Totals the reply works out in the open, like "$930 + $837 = $1,767". A total
 * is accepted only if the sum is right and every price in it is itself
 * accepted. Bare numbers in the working (3 weeks, 2 kids) are counts.
 */
function shownWorking(reply: string, accepted: (v: number) => boolean): number[] {
  const results: number[] = [];
  const ok = (v: number) => accepted(v) || results.some((r) => Math.abs(r - v) < 0.01);
  const exprs = [...reply.replace(/[\u2010-\u2015\u2212]/g, "-").matchAll(EXPRESSION)];
  // Repeat so a total that uses an earlier shown total ("$930 + $837") is accepted too.
  for (let pass = 0; pass < 3; pass++) {
    for (const m of exprs) {
      const tokens = m[1].match(new RegExp(`${NUM}|[x×*+/-]|times|plus|minus`, "gi")) ?? [];
      const terms: number[] = [];
      let sign = 1;
      let product: number | null = null;
      let pendingOp: "*" | "/" | null = null;
      let valid = true;
      for (const tok of tokens) {
        const t = tok.trim().toLowerCase();
        if (/^[x×*]$|^times$/.test(t)) pendingOp = "*";
        else if (t === "/") pendingOp = "/";
        else if (t === "+" || t === "plus" || t === "-" || t === "minus") {
          if (product !== null) terms.push(sign * product);
          product = null;
          sign = t === "+" || t === "plus" ? 1 : -1;
        } else {
          const v = toNumber(t);
          if (t.includes("$") && !ok(v)) valid = false;
          product = product === null ? v : pendingOp === "/" ? product / v : product * v;
          pendingOp = null;
        }
      }
      if (product !== null) terms.push(sign * product);
      const total = terms.reduce((a, b) => a + b, 0);
      const claimed = toNumber(m[2]);
      if (valid && Math.abs(total - claimed) < 0.01 && !ok(claimed)) results.push(claimed);
    }
  }
  return results;
}

export type GroundingSources = {
  /** Every text the assistant was given: club details, notices, the conversation so far. */
  texts: string[];
  /** Calendar days near today (month*100+day), so "this Saturday, Oct 17" is allowed. */
  nearbyDays: number[];
};

/** Figures in `reply` that none of the sources support. Empty means the reply is grounded. */
export function unsupportedFigures(reply: string, sources: GroundingSources): string[] {
  const known = sources.texts.flatMap(extractFigures);
  const has = (kind: FigureKind) => known.filter((f) => f.kind === kind).map((f) => f.value);

  const money = derivablePrices(has("money"), /\bminutes?\b|\blate\b/i.test(reply));
  const acceptedMoney = (v: number) => money.some((m) => Math.abs(m - v) < 0.01);
  const worked = shownWorking(reply, acceptedMoney);
  const times = new Set(has("time"));
  const dates = new Set([...has("date"), ...sources.nearbyDays]);
  const percents = new Set(has("percent"));

  const bad: string[] = [];
  for (const f of extractFigures(reply)) {
    const ok =
      f.kind === "money"
        ? acceptedMoney(f.value) || worked.some((v) => Math.abs(v - f.value) < 0.01)
        : f.kind === "time"
          ? times.has(f.value)
          : f.kind === "date"
            ? dates.has(f.value)
            : percents.has(f.value);
    if (!ok && !bad.includes(f.text)) bad.push(f.text);
  }
  return bad;
}
