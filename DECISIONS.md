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
10. **Fewer handoffs over time**: a drafted reply for the owner, and "teach the assistant this" from the owner's own answers. A family card from what each parent said.
11. **More tests, and quicker calls**: a simulated parent writes test conversations on request, which took the set from 35 to about 110. A check replays only the tests a change can reach. Calls answer at lower effort.

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

**Handoffs should shrink over time, not stay the owner's job forever.** When the assistant hands a conversation over, Claude Sonnet 5.5 drafts the owner's reply from the club details. Anything only the owner knows or decides goes in as a [blank], and the reply can't be sent until every blank is filled in, so the draft never puts a guess in the owner's mouth. After the owner replies, a second step asks whether the answer is something any family could be told ("shin guards are required") or a decision for this one family (a refund). Only the first kind is offered as "Teach the assistant this?". It becomes a proposed change and a test, through the same check and publish as a correction. A refund decision in testing was correctly left alone.

**A family card, from what the parent said.** After each parent message, Claude Haiku 5.5 re-reads the conversation and records the children's first names and ages, the programs they asked about, whether they want a trial, any contact details they gave, and one line to remember. The owner sees it on the conversation, and the inbox shows "wants a trial" so follow-ups don't get lost. It holds only what the parent said, never health details, and nothing looked up elsewhere. It isn't fed back to the assistant: the assistant already reads the whole conversation, so the card would add nothing but a second copy that could drift.

**Before/after checks confirm changes before reporting them.** Both versions answer every test once. Any test whose result differs gets two more tries on each side. Without this, ordinary variation in wording would cry wolf.

With about 100 tests, that wasn't enough. Changing the camp dates came back "Hold on: 3 answers got worse", all of them Little Kicks tests that sometimes fail on the live version too. If enough tests each pass most of the time, a few will fail three tries in a row by chance after any change. So a test is now called worse only when its result after the change would happen less than 1 time in 100 by chance, given its whole record on the current version (every check, not just this one). A test that has passed 10 times out of 10 and now fails 2 of 3 is worse. A test that already fails a quarter of the time and now fails 3 of 3 is "mixed", and shown, but doesn't block. Recomputed with this rule, the camp change was safe with 12 mixed. The brief's failure was still caught: a late-pickup reminder added as an every-conversation rule took the leak test from 3 of 3 to 0 of 3, "Hold on: 1 answer got worse". A full check of about 100 tests costs about $0.50 and takes about 5 minutes. A before/after check of a change that reaches every test costs about $1.30–1.60 and takes about 12 minutes, which is why checks skip tests a change can't reach.

**A change can only be blamed for tests it reaches.** Found when teaching the assistant about shin guards: the check said "Hold on, 2 answers got worse", and neither was about gear. The new rule wasn't even in their prompts. Each test now records the topics of every turn. If the details and rules for those topics come out word for word the same before and after the change, the change can't have caused a difference there. It's reported as variation, with a note saying so, and gets no re-tries. This is computed, not judged, and costs nothing.

**Tests written by a simulated parent, then frozen.** Thirty-odd hand-written tests can't cover what parents actually send. The owner can ask for "10 tests about refunds" on *How it's doing*. Claude Sonnet 5.5 plans each one as a parent with a reason to get in touch, then plays that parent against the live assistant, so a follow-up reacts to a real reply. What the parent said is then frozen into a script: a test that says something different on every run would make a before/after check compare two different conversations. A separate call writes what a good answer looks like, from the club details and the parent's messages only, never the assistant's replies, so a test can't bake in a mistake the assistant made while it was being written. It never writes a figure from the details ("its correct price"), so tests survive the owner's edits. Requested tests wait for the owner to keep or remove them: a test nobody has read can hold a wrong expectation and raise false alarms on every check after.

The first batch of 75 showed two problems, both fixed in the prompts. Most follow-ups were "when will the owner get back to me?", so the final reply being graded was a sign-off, not the parent's question. And some expectations copied the club's address. The second batch's follow-ups dig into the question ("so is that a no on cash then?"). Most tests still expect a handoff, because a simulated parent probes until it finds what the club details don't say (gear, before-care, make-up classes). That reflects how thin the details are, and it's the list of things worth adding to them.

Checking the batch against the live assistant was worth it. Of 76 tests, 20 failed. Seven had caught real mistakes, for example offering a trial in a full class, or reassurances the details don't support ("nothing changes with your 10:00 spot"). Two were the figure check rejecting honest time arithmetic: "a text by 8am" for a 10am class decided two hours before. It now allows a time one duration from a known time when that duration is in the club details and the reply names it. Eight expected too much, for example that a reply repeat everything said earlier; I removed them and tightened the prompt. Three expected no handoff where one was reasonable, and I loosened those. Writing tests also turned up an SDK quirk: its structured-output parser reads each text block on its own, and the model now and then splits its JSON over two. About 1 call in 50 failed that way. Every call now goes through one helper that reads them together. The final check found one more of the same kind. The topic labeller once returned a label that isn't on its list, so the whole answer failed, and a parent would have been told the assistant was unavailable. Unknown labels are now dropped.

**A check replays only the tests a change can reach.** With about 100 tests, replaying all of them for every change takes a while. Every answer sees all four programs, so a change to a program's price or dates does reach every test and replays them all. But rules and policies are scoped by topic, and most corrections and lessons are rules. Each past check records the topics every turn of every test was given. If the details and rules for all of those topics come out word for word the same after the change, the test is skipped, and the verdict says how many were. A test with no history yet is always replayed, so a correction's new test always runs. If no test reaches the change at all, the verdict says so instead of "safe", and points the owner to *Try your changes*.

**Calls answer at lower effort.** A caller waits in silence, so speed matters more on a call than in a text. I measured 30 test questions asked on a call (`scripts/compare-voice.ts`):

| Setting | Passed | Median turn | 90th percentile |
|---|---|---|---|
| Claude Opus 5.5, effort medium (before) | 30/30 | 5.0 s | 6.6 s |
| Claude Opus 5.5, effort low (now) | 30/30 | 4.1 s | 5.6 s |
| Claude Sonnet 5.5, effort low | 27/30 | 3.2 s | 4.3 s |

Sonnet was quickest but made needless handoffs (a price question for a 4-year-old), and on a weather question it leaned toward saying practice was on. Texts stay at medium. The browser also speaks the reply as soon as it arrives, without waiting to reload the thread, and says "One moment" if the reply takes more than a second and a half, as a person on the phone would.

**Grading: hard checks first, then a judge.** "Did it hand off" and "did it say a banned phrase" are checked in code and override the judge. A different model (Claude Sonnet 5.5) grades correctness against the snapshot under test, rule-following, handoff, tone, and the test's own expectation. Facts that change (prices, dates) are judged against the snapshot, not hard-coded in tests, so a price change doesn't break the tests. Plumbing failures go in a separate table and are never averaged in as wrong answers.

**The grader has to show its evidence** (v3). The first version decided pass/fail first and explained after, and sometimes failed an answer while its own reason said "the real issue is none". Now it reasons before deciding, and "correct" fails only when it quotes a specific statement the club details don't support. A second, narrower call then checks each quoted statement on its own, and only confirmed ones count. That call only happens when something was quoted. On the live assistant, "correct" went from 33/35 to 36/36, and the before/after check on the gear lesson went from "Hold on" to "Safe to publish". The remaining failure is a real one (the assistant handing off a question about shy kids it could have answered). Each run records its grader version, so scores from different graders aren't mixed up.

**The owner's pages are built around what to do next, in plain words.** The owner isn't technical and is usually on a phone at the field. Home answers three questions in order: who needs me, which families should I follow up, and is the assistant OK ("Doing well", not 87% and six categories). Club details show each program, policy and rule the way parents hear it, with *Edit* on each, instead of a wall of form fields. "How it's doing" leads with the answers to look at and one line on what went wrong. Scores by area and past checks are under *Details*, for whoever wants them. On a phone the tabs move to the bottom of the screen.

**Code changes get the same before/after as club details.** The owner's check compares two versions of the club details; a change to the prompt or the model needs the same comparison across two versions of the code. `npm run eval -- --reps 3` on the old code, then `--reps 3 --against <run>` on the new, uses the same chance-aware verdict, with only the old run as the record. Comparing two single checks by eye was the gap: with 100 tests, a dozen differ between any two runs by chance.

**The owner calibrates the grader.** The spot-check page shows a graded answer without the verdict, asks the owner for their own call, then reveals the grader's verdict. The agreement rate is shown next to the scores.

## Models

| Role | Model | Why |
|---|---|---|
| Answers parents | Claude Opus 5.5, effort `medium` by text, `low` on a call | Correctness and rule-following matter most; a caller is waiting |
| Labels topics | Claude Haiku 5.5, effort `low` | Cheap, well-defined task |
| Grades answers, reviews real replies, drafts the owner's replies, spots lessons | Claude Sonnet 5.5 | A different model from the answerer |
| Keeps the family card | Claude Haiku 5.5 | Cheap extraction after every message |
| Plays parents to write tests | Claude Sonnet 5.5 | Realistic variety; a different model from the answerer |
| Proposes fixes | Claude Opus 5.5 | Rare, and quality matters |

Measured costs: about $0.01–0.02 per parent message, plus about $0.006 for its review and well under a cent for the family card; about half a cent for a drafted owner reply, and the same to look for a lesson in the owner's answer; about $0.50 for a full check of about 100 tests, and $1.30–1.60 for a before/after check that reaches every test; about 2 cents to write a test.

## Left out, and why

- **Real phone and SMS** (e.g. Twilio). The brief allows a browser simulation. The engine is channel-agnostic, so adding them is plumbing rather than design.
- **Voice quality.** Voice uses the browser's built-in speech recognition and speech output, so it's Chrome/Edge only. The app picks the most natural voice installed (Edge's "Natural" voices, macOS Premium/Enhanced voices, Chrome's Google voice), but it still sounds synthetic. The production path is a hosted text-to-speech service (e.g. ElevenLabs or OpenAI TTS, about a cent per reply) behind the same `speak()` call. I left it out because it adds a second provider and isn't where trust is won or lost.
- **Owner notifications.** Escalations show up in the inbox but don't text the owner. Adding that is the next step after real SMS.
- **Login.** This is a single-owner local demo, so the owner pages have no auth. They would need it before going online.
- **A simulated parent inside every check.** Simulated parents write tests, but the tests replay as fixed scripts. A parent improvising during the check would react to each version's replies differently, so a before/after difference could come from the parent rather than the change. The cost is that a scripted follow-up can sound slightly off when the assistant's earlier reply changes.
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

## Next, and why not now

In the order I'd do them:

1. **Have the owner spot-check the grader.** Grader v3 hasn't been checked against the owner's own calls yet. Every score leans on it, so this comes first, and it costs the owner about ten minutes.
2. **Real text messages, and texting the owner when something needs them.** This is where the assistant meets real families. It's plumbing (e.g. Twilio) on an engine that already doesn't care about the channel, and it's left out because the brief allows a browser simulation.
3. **Streaming the reply on calls.** Most of a call's wait is now the whole reply being written before any of it is spoken. Speaking the first sentence while the rest is written would bring the first words down to about 1–2 seconds. It needs a streamed reply plus the figure check run sentence by sentence, which is a real change to the engine.
4. **Owner login, then verified parents and read-only lookups** (see *Tools* above). Not before real families use it, and not before the verification design is agreed.
5. **Teaching from anything the owner writes**, not only replies to handovers; a rollback button; adding a program in the editor. All are useful, and none changes whether the owner can trust what parents are told.

## Known limitations

- The judge is a different model but from the same family as the answerer, so it may share blind spots. The spot-check exists to measure this.
- The grader can still be wrong. Version 3 fixed the clearest kind (failing answers its own reason called fine), but nobody has spot-checked it yet: there are no owner labels to measure it against. The spot-check page is how that would be found out.
- Tests written by a simulated parent are only as good as the expectation written for them. The generated set was read through once and checked against the live assistant, but not line by line by the owner. Their tags mark them, and any of them can be turned off.
- A check skips a test only on the evidence of the topics it was given in past checks. A test whose topics vary from run to run could, rarely, touch a change on a run it was skipped.
- A lesson is offered only after the owner sends their reply, and only for a conversation the assistant handed over. Something the owner volunteers in an ordinary conversation isn't picked up.
- The figure check understands figures, not meaning: "camp is in the summer" can't be wrong by its rules. The reviewer and the tests cover the rest.
- The reviewer can miss a bad reply, so *Something wrong with this reply?* stays on every reply. It can also flag a fine one; "It's fine" costs one click, and the dismissal count shows how often that happens.
- A single check runs each test once. Small differences between two checks can be noise. The before/after check deals with this; comparing two separate single checks by eye doesn't.
- Every check spends real money. The cost is shown on each check.
