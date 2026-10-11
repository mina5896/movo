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

## Key decisions

**Knowledge is an immutable snapshot, read at answer time.** Every answer reads the live snapshot fresh, so a published edit takes effect on the next message, and there's nothing to go stale. Publishing promotes a draft and archives the old live version. Eval runs record the snapshot hash they scored.

**Rules and policies are scoped by topic.** A cheap classifier (Claude Haiku 5.5) labels each parent message with topics, and only the rules and policies for those topics are put in front of the answerer. A rule about late pickup physically isn't in the prompt when a parent asks where the fields are. Tone and honesty rules are marked "every conversation". There are "leak" tests guarding this.

**Topics carry over two turns.** Found in testing: a follow-up like "actually, can someone call me" was classified on its own, so the policies from the previous answer dropped out, and the assistant took back correct things it had said ("I don't actually have those details"). Recent assistant turns' topics now stay in scope. There's a test for it (`follow-up-keeps-facts`).

**The assistant must hand off rather than guess.** Structured output forces a decision on every turn: reply, escalate yes/no, reason for the owner, what the parent was told happens next. Escalation flags the thread in the owner's inbox. If the model call fails, the parent's message is still saved and the thread is flagged.

**One thread per family, across channels.** Text and voice turns go into the same message list, tagged by channel. A call starts with the whole text history, and vice versa. With a phone number, a family is matched by phone.

**A correction becomes a change and a test.** The owner writes what was wrong in their own words. A model proposes the smallest change: fix a fact, reword a rule, or add a narrowly scoped rule. It also proposes a test pinned to that conversation. The owner sees both in plain words and approves. The change goes to the draft, never straight to parents. The test joins every future check, so a later edit can't silently bring the mistake back. That's how "never correct the same mistake twice" is enforced rather than hoped for.

**Before/after checks confirm changes before reporting them.** Both versions answer every test once. Any test whose result differs gets two more tries on each side. It's reported as "got worse" only if it consistently passes before and fails after, otherwise as "mixed". Without this, ordinary variation in wording would cry wolf. A full check costs about $0.70 and takes about 4 minutes.

**Grading: hard checks first, then a judge.** "Did it hand off" and "did it say a banned phrase" are checked in code and override the judge. A different model (Claude Sonnet 5.5) grades correctness against the snapshot under test, rule-following, handoff, tone, and the test's own expectation. Facts that change (prices, dates) are judged against the snapshot, not hard-coded in tests, so a price change doesn't break the tests. Plumbing failures go in a separate table and are never averaged in as wrong answers.

**The owner calibrates the grader.** The spot-check page shows a graded answer without the verdict, asks the owner for their own call, then reveals the grader's verdict. The agreement rate is shown next to the scores.

## Models

| Role | Model | Why |
|---|---|---|
| Answers parents | Claude Opus 5.5, effort `medium` | Correctness and rule-following matter most |
| Labels topics | Claude Haiku 5.5, effort `low` | Cheap, well-defined task |
| Grades answers | Claude Sonnet 5.5 | A different model from the answerer |
| Proposes fixes | Claude Opus 5.5 | Rare, and quality matters |

Measured costs: about $0.01–0.02 per parent message, $0.17 for a full check of 30 tests, and $0.70 for a before/after check.

## Left out, and why

- **Real phone and SMS** (e.g. Twilio). The brief allows a browser simulation. The engine is channel-agnostic, so adding them is plumbing rather than design.
- **Voice quality.** Voice uses the browser's built-in speech recognition and speech output, so it's Chrome/Edge only. The app picks the most natural voice installed (Edge's "Natural" voices, macOS Premium/Enhanced voices, Chrome's Google voice), but it still sounds synthetic. The production path is a hosted text-to-speech service (e.g. ElevenLabs or OpenAI TTS, about a cent per reply) behind the same `speak()` call. I left it out because it adds a second provider and isn't where trust is won or lost.
- **Owner notifications.** Escalations show up in the inbox but don't text the owner. Adding that is the next step after real SMS.
- **Login.** This is a single-owner local demo, so the owner pages have no auth. They would need it before going online.
- **Simulated parents.** `PARENT_SIM` is defined, but multi-turn tests use scripted parent messages. Scripts are repeatable and cheaper; a simulated parent adds coverage but also noise, which hurts before/after comparisons.
- **Adding or removing programs and policies in the editor.** The owner can edit every field and add, remove or toggle rules, but adding a whole new program needs code. Rules cover most "new information" cases in the meantime.
- **Rolling back to an earlier version.** Old snapshots are kept (archived) but there's no button to restore one.
- **Train/test split.** The schema has it, but with about 30 tests and no automated prompt tuning there's nothing to overfit yet.
- **Background job durability.** Checks run inside the web server process. If it restarts mid-check, the check is marked as not finished and has to be rerun.

## Known limitations

- The judge is a different model but from the same family as the answerer, so it may share blind spots. The spot-check exists to measure this.
- A single check runs each test once. Small differences between two checks can be noise. The before/after check deals with this; comparing two separate single checks by eye doesn't.
- Every check spends real money. The cost is shown on each check.
