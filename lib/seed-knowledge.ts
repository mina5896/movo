import type { Knowledge } from "@/lib/engine/snapshot";

/**
 * The club as the brief describes it, plus the two corrections made while
 * testing (marked below), so a fresh install starts where the demo left off.
 * The owner will change all of it from the UI; nothing here is referenced
 * anywhere else in the code.
 */
export const SEED_KNOWLEDGE: Knowledge = {
  club: { name: "Riverside Kickers", location: "Riverside Park fields, 400 River Road" },
  programs: [
    {
      id: "little-kicks",
      name: "Little Kicks",
      ages: "3-5",
      schedule: "Saturdays, 9:00-9:45am or 10:00-10:45am",
      price: "$120 per 8-week session",
      availability:
        "The 9:00 class is currently full and has a waitlist. The 10:00 class has space.",
    },
    {
      id: "rec-league",
      name: "Rec League",
      ages: "6-10",
      schedule: "Tuesdays and Thursdays, 5:00-6:15pm; games on Saturdays",
      price: "$240 per season",
    },
    {
      id: "travel-teams",
      name: "Travel Teams",
      ages: "9-14",
      schedule: "Practice three times a week; weekend games; tryout required",
      price: "$95 per month, plus an $85 uniform",
      availability: "Fall tryouts have finished. The next tryouts are in January.",
    },
    {
      id: "summer-camp",
      name: "Summer Camp",
      ages: "5-12",
      schedule: "Monday to Friday, 9am-3pm, June 21 to August 13",
      price: "$310 per week",
    },
  ],
  policies: [
    {
      id: "free-trial",
      name: "Free trial",
      topic: "trial",
      detail:
        "One free class for Little Kicks and Rec League. No trial for Travel Teams.",
    },
    {
      id: "siblings",
      name: "Siblings",
      topic: "siblings",
      detail: "10% off for each additional child.",
    },
    {
      id: "refunds",
      name: "Refunds",
      topic: "refunds",
      detail:
        "Full refund before the first class. After that, credit toward a future session and no cash refund.",
    },
    {
      id: "weather",
      name: "Weather",
      topic: "weather",
      detail:
        "The owner decides two hours before the start time and texts every family either way.",
    },
    {
      id: "late-pickup",
      name: "Late pickup",
      topic: "late_pickup",
      detail: "$1 per minute after the first 10 minutes.",
    },
    {
      id: "location",
      name: "Location",
      topic: "location",
      detail: "Riverside Park fields, 400 River Road.",
    },
  ],
  rules: [
    {
      id: "tone",
      // The second half came from an owner correction during testing: "info?"
      // got every program and price back.
      text: "Keep replies short and friendly, and use the parent's first name when you know it. When a parent just says hi or asks for 'info' without saying what they want, don't list our programs, prices or schedules. Greet them and ask how old their child is and what they're looking for, then share only the details that fit.",
      scope: "always",
      source: "owner",
      active: true,
    },
    {
      id: "no-pressure",
      text: "Never pressure a family to sign up.",
      scope: "always",
      source: "owner",
      active: true,
    },
    {
      id: "no-invention",
      text: "Never invent an answer. If the club details do not cover the question, say you will check with the owner and tell the parent what happens next.",
      scope: "always",
      source: "owner",
      active: true,
    },
    {
      id: "owner-only",
      text: "Injuries, payment disputes, financial aid and any concern about a specific coach are handled by the owner. Acknowledge the parent warmly, do not attempt to resolve it, and hand it over.",
      scope: "always",
      source: "owner",
      active: true,
    },
    {
      // Named verbatim in the brief as an example of the owner's own rules.
      id: "no-promised-spots",
      text: "Do not promise a spot until it has been paid for.",
      scope: ["registration", "schedule", "tryouts"],
      source: "owner",
      active: true,
    },
    {
      // The other rule the brief names. Scoped, so it cannot leak into
      // unrelated conversations the way the late-pickup note once did.
      id: "mention-free-trial",
      text: "Always mention the free trial when a parent is considering Little Kicks or Rec League.",
      scope: ["pricing", "trial", "registration", "schedule"],
      source: "owner",
      active: true,
    },
    {
      // From an owner correction during testing: a call request was handed
      // over without anything the owner could call back on.
      id: "fb-callback",
      text: "When a parent asks for a phone call, tell them you'll pass it to me, and ask for the best phone number to reach them and a good time to call, so I can actually call back. Don't promise an exact call time.",
      scope: ["other", "injury", "payment_dispute", "financial_aid", "coach_concern"],
      source: "feedback",
      active: true,
    },
  ],
};
