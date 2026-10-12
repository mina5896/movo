# Decisions

What I built, in the order I built it, why, and what I left out.

## What matters most

The previous chatbot was switched off because of two kinds of harm: a stale answer (old camp dates for a week) and a rule leaking into unrelated conversations (the late-pickup fee). So the priority was not "an assistant that answers" but **an owner who can see what a change will do before parents see it**. Everything else serves that.

Build order:

1. **Answer engine** that only knows what the owner has written, and hands off when it doesn't know.
2. **Parent chat by text and voice** on one thread per family, so nobody repeats themselves.
3. **Owner inbox** showing which conversations need the owner, with the reason.
4. **Club details editor** that writes to a draft, with a "try it" chat against the draft.
5. **Before/after check**: replay every test conversation on live and draft, and show what got worse.
6. **Corrections in plain words** that become a reviewed change plus a permanent test.
7. **Grader spot-check**, so the owner knows how far to trust the scores.
8. **Less work for the owner**: every real reply is double-checked by a second model, and approving a fix starts the check on its own.
9. **Today's date, owner notices, and a figure check in code** before any reply is sent.

## Key decisions

**Knowledge is an immutable snapshot, read at answer time.** Every answer reads the live snapshot fresh, so a published edit takes effect on the next message, and there's nothing to go stale. Publishing promotes a draft and archives the old live version. Eval runs record the snapshot hash they scored.

**Rules and policies are scoped by topic.** A cheap classifier (Claude Haiku 5.5) labels each parent message with topics, and only the rules and policies for those topics are put in front of the answerer. A rule about late pickup physically isn't in the prompt when a parent asks where the fields are. Tone and honesty rules are marked "every conversation". There are "leak" tests guarding this.

**Topics carry over two turns.** Found in testing: a follow-up like "actually, can someone call me" was classified on its own, so the policies from the previous answer dropped out, and the assistant took back correct things it had said ("I don't actually have those details"). Recent assistant turns' topics now stay in scope. There's a test for it (`follow-up-keeps-facts`).

**The assistant must hand off rather than guess.** Structured output forces a decision on every turn: reply, escalate yes/no, reason for the owner, what the parent was told happens next. Escalation flags the thread in the owner's inbox. If the model call fails, the parent's message is still saved and the thread is flagged.

**One thread per family, across channels.** Text and voice turns go into the same message list, tagged by channel. A call starts with the whole text history, and vice versa. With a phone number, a family is matched by phone.

**A correction becomes a change and a test.** The owner writes what was wrong in their own words. A model proposes the smallest change: fix a fact, reword a rule, or add a narrowly scoped rule. It also proposes a test pinned to that conversation. The owner sees both in plain words and approves. The change goes to the draft, never straight to parents. The test joins every future check, so a later edit can't silently bring the mistake back. That's how "never correct the same mistake twice" is enforced rather than hoped for.

**The owner shouldn't have to find mistakes or run the process.** The owner isn't technical and has a club to run. Two things keep the work down to "read a flag, write a sentence, publish":

- *Every real reply is double-checked.* After the parent has the reply (so it never slows them down), Claude Sonnet 5.5 reads it against the club details and rules it was given. A doubtful reply moves its conversation to *Needs you*, with the concern and a suggested correction in the owner's voice. The owner clicks *Fix it* or *It's fine*. The reviewer only points; changes still go through the correction and the check. How the owner answers its flags (corrected vs. "it's fine") is shown as its track record. This costs about half a cent per reply and can be turned off with `MOVO_AUTO_REVIEW=off`.
- *One click from fix to verdict.* Approving a proposed fix also starts the before/after check, and the result is one line: "✓ Safe to publish: 2 answers got better, nothing got worse", or "Hold on: 1 answer got worse". A Publish button sits next to it, on the conversation itself. The side-by-side answers are a link away for anyone who wants them.

**The assistant knows today's date and the owner's notices.** "Is there practice tonight?" needs the weekday, and the brief's own weather policy means the answer changes daily. The owner posts a notice ("Tonight's practice is cancelled") that the assistant knows at once, and it disappears at the end of the day, a week, or when taken down. Notices skip the draft and the check on purpose. A weather call that waits four minutes is useless, and the owner is making the announcement anyway. The safety comes from them expiring by themselves (so they can't go stale the way the camp dates did) and from the assistant only mentioning a notice when it's relevant. A test checks a field closure doesn't come up in a price question. Tests pin their own date and notices, so they never depend on what's posted today.

Found when the date was added: the club details say camp is "June 21 to August 13" with no year. Told to assume the next one, the assistant started saying "2027", which the club details don't say. It now repeats dates as written. The year belongs in the club details, and that's the owner's edit to make.

**Every price, time and date is checked in code before a reply is sent.** Each figure in a reply must appear in the club details, a notice, the conversation, or the days around today. A few one-step calculations are also allowed (several weeks, 10% off a sibling, a per-class price). A longer total is accepted only when the reply shows the working and the sum is right ("$930 + $837 = $1,767"). If the first draft fails, the assistant rewrites it once with the problem named, which usually just means showing the working. A figure that still fails goes to the owner as a flagged reply. The allowed calculations are deliberately narrow: summing every pair of the club's prices would have let 1,700 of the first 2,000 dollar amounts through. Unit tests cover the cases.

**Before/after checks confirm changes before reporting them.** Both versions answer every test once. Any test whose result differs gets two more tries on each side. It's reported as "got worse" only if it consistently passes before and fails after, otherwise as "mixed". Without this, ordinary variation in wording would cry wolf. A full check costs about $0.70 and takes about 4 minutes.

**Grading: hard checks first, then a judge.** "Did it hand off" and "did it say a banned phrase" are checked in code and override the judge. A different model (Claude Sonnet 5.5) grades correctness against the snapshot under test, rule-following, handoff, tone, and the test's own expectation. Facts that change (prices, dates) are judged against the snapshot, not hard-coded in tests, so a price change doesn't break the tests. Plumbing failures go in a separate table and are never averaged in as wrong answers.

**The owner calibrates the grader.** The spot-check page shows a graded answer without the verdict, asks the owner for their own call, then reveals the grader's verdict. The agreement rate is shown next to the scores.

## Models

| Role | Model | Why |
|---|---|---|
| Answers parents | Claude Opus 5.5, effort `medium` | Correctness and rule-following matter most |
| Labels topics | Claude Haiku 5.5, effort `low` | Cheap, well-defined task |
| Grades answers, reviews real replies | Claude Sonnet 5.5 | A different model from the answerer |
| Proposes fixes | Claude Opus 5.5 | Rare, and quality matters |

Measured costs: about $0.01–0.02 per parent message, plus about $0.006 for its review, $0.17 for a full check of 30 tests, and $0.70 for a before/after check.

## Left out, and why

- **Real phone and SMS** (e.g. Twilio). The brief allows a browser simulation. The engine is channel-agnostic, so adding them is plumbing rather than design.
- **Voice quality.** Voice uses the browser's built-in speech recognition and speech output, so it's Chrome/Edge only. The app picks the most natural voice installed (Edge's "Natural" voices, macOS Premium/Enhanced voices, Chrome's Google voice), but it still sounds synthetic. The production path is a hosted text-to-speech service (e.g. ElevenLabs or OpenAI TTS, about a cent per reply) behind the same `speak()` call. I left it out because it adds a second provider and isn't where trust is won or lost.
- **Owner notifications.** Escalations show up in the inbox but don't text the owner. Adding that is the next step after real SMS.
- **Login.** This is a single-owner local demo, so the owner pages have no auth. They would need it before going online.
- **Simulated parents.** `PARENT_SIM` is defined, but multi-turn tests use scripted parent messages. Scripts are repeatable and cheaper; a simulated parent adds coverage but also noise, which hurts before/after comparisons.
- **Adding or removing programs and policies in the editor.** The owner can edit every field and add, remove or toggle rules, but adding a whole new program needs code. Rules cover most "new information" cases in the meantime.
- **Rolling back to an earlier version.** Old snapshots are kept (archived) but there's no button to restore one.
- **Train/test split.** The schema has it, but with about 30 tests and no automated prompt tuning there's nothing to overfit yet.
- **Tools: reading the club's own systems** (registration, a Google Drive roster, payments). Today the assistant's only action is handing a conversation to the owner. The club details are small enough to send in full on every turn, so it has nothing to look up. Member data is the risky part: over SMS we can't confirm who is texting, so "is my son registered?" could hand a child's details to a stranger. When it's added:
  - verify who the parent is first: on the web, they're signed in to the club's account; by text or phone, their number matches the one on the registration, plus a one-time code before anything sensitive;
  - read-only tools, limited to that parent's own family;
  - anything that changes data (a refund, a roster change) becomes a request the owner approves;
  - every tool call is logged in the thread, and each tool gets its own tests.

  A family memory (children, ages, interest), planned next, is the safe first step: the assistant knows the family from what they told it, not from the club's records.
- **Background job durability.** Checks run inside the web server process. If it restarts mid-check, the check is marked as not finished and has to be rerun.

## Known limitations

- The judge is a different model but from the same family as the answerer, so it may share blind spots. The spot-check exists to measure this.
- The grader can be too strict. In the latest run, two of the three failures were it failing correct answers, once while its own reason said "nothing is invented". The spot-check page is how the owner finds this out; tightening the grader prompt (and re-checking it against the owner's labels) is next.
- The figure check understands figures, not meaning: "camp is in the summer" can't be wrong by its rules. The reviewer and the tests cover the rest.
- The reviewer can miss a bad reply, so *Something wrong with this reply?* stays on every reply. It can also flag a fine one; "It's fine" costs one click, and the dismissal count shows how often that happens.
- A single check runs each test once. Small differences between two checks can be noise. The before/after check deals with this; comparing two separate single checks by eye doesn't.
- Every check spends real money. The cost is shown on each check.
