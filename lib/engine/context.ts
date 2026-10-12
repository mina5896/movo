/**
 * What changes from one moment to the next rather than with each published
 * version: today's date and the owner's current notices. Kept out of the
 * knowledge snapshot so that a notice takes effect at once and a check of a
 * draft compares like with like.
 */

/** The club's local time zone. "Tonight" and "this Saturday" are the club's, not the server's. */
export const CLUB_TIMEZONE = process.env.MOVO_TIMEZONE ?? "America/New_York";

export type Notice = {
  text: string;
  /** Unix seconds. */
  createdAt: number;
  /** Unix seconds. */
  expiresAt: number;
};

const dayFormat = (tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" });
const timeFormat = (tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });

/** "Tuesday, October 13, 2026 at 2:00 PM" in the club's time zone. */
export function describeMoment(at: Date, tz = CLUB_TIMEZONE): string {
  return `${dayFormat(tz).format(at)} at ${timeFormat(tz).format(at)}`;
}

/** "Tuesday, October 13, 2026" in the club's time zone. */
export function describeDay(at: Date, tz = CLUB_TIMEZONE): string {
  return dayFormat(tz).format(at);
}

/** The prompt section for this moment. Also given to the grader and the reviewer, so they judge against the same facts. */
export function describeContext(now: Date, notices: Notice[], tz = CLUB_TIMEZONE): string {
  const lines = [`## Right now\n\nIt is ${describeMoment(now, tz)} (club time).`];
  if (notices.length > 0) {
    lines.push(
      `## Current notices from the owner

The owner posted these. They override the regular schedule where they conflict. "Tonight" or "today" in a notice means the day it was posted. Only mention a notice when it bears on what the parent asked.

${notices
  .map(
    (n) =>
      `- ${n.text} (posted ${describeMoment(new Date(n.createdAt * 1000), tz)}; valid until ${describeMoment(new Date(n.expiresAt * 1000), tz)})`,
  )
  .join("\n")}`,
    );
  } else {
    lines.push("There are no current notices from the owner.");
  }
  return lines.join("\n\n");
}

type Parts = { y: number; m: number; d: number; h: number; min: number; s: number };

function partsIn(at: Date, tz: string): Parts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const get = (type: string) => Number(f.formatToParts(at).find((p) => p.type === type)!.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** Unix seconds of midnight at the end of the club's day, `days` days from now (0 = tonight). */
export function endOfClubDay(now: Date, days = 0, tz = CLUB_TIMEZONE): number {
  const p = partsIn(now, tz);
  const guess = Date.UTC(p.y, p.m - 1, p.d + days + 1);
  const g = partsIn(new Date(guess), tz);
  const offset = Date.UTC(g.y, g.m - 1, g.d, g.h, g.min, g.s) - guess;
  return Math.floor((guess - offset) / 1000);
}

/** The next `days` calendar days in the club's time zone, as month*100+day, for checking dates in replies. */
export function upcomingDays(now: Date, days: number, tz = CLUB_TIMEZONE): number[] {
  const out: number[] = [];
  for (let i = -1; i <= days; i++) {
    const p = partsIn(new Date(now.getTime() + i * 86_400_000), tz);
    out.push(p.m * 100 + p.d);
  }
  return out;
}
