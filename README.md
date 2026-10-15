# Riverside Kickers assistant

An assistant that answers parents by text and voice for a youth soccer club, and an owner view to watch it, correct it, and check every change before parents see it.

Design and scope decisions: [DECISIONS.md](DECISIONS.md).

## Run it

Needs Node 20+ and an Anthropic API key with credit.

```bash
npm install
cp .env.local.example .env.local   # then put your key in ANTHROPIC_API_KEY
npm run push                       # create the SQLite tables
npm run seed                       # club details from the brief
npm run dev
```

- Parent view: http://localhost:3000 (use Chrome or Edge for the 📞 call button)
- Owner view: http://localhost:3000/owner

## A tour for the owner

1. **Talk to it as a parent** at `/`. Try the hard ones: "info?", "Coach Mike yelled at my daughter", "can someone just call me". Switch to a call partway through; it remembers the texts. On a call it answers at lower effort to be quicker, and says "one moment" if a reply takes longer than a second and a half.
2. **Home** (`/owner`): what needs you, with the reason in one line; families who want a trial or to sign up; and how the assistant is doing, in words. Conversations that need you are ones the assistant handed to you and ones holding a reply the second-model review doubts. Each shows what the family told us (children, programs, "wants a trial"). When the assistant hands one over, a reply is drafted for you: *Use this draft*, fill in the [blanks], send. If your answer is something any family could be told, it offers *Teach the assistant this?*, so the same question stops coming to you.
3. **Fixing a reply.** On a flagged reply click *Fix it*: the correction is pre-written, edit it if you like. On any other reply, *Not right?* does the same. You'll see the proposed fix and a new test in plain words. *Looks right - check it* adds it to your unpublished changes and starts the before/after check; when it says *Safe to publish*, publish from right there.
4. **Notices** (top of `/owner/club`): post tonight's weather call or a field closure. The assistant knows it immediately, and it disappears at the end of the day unless you pick longer.
5. **Club details** (`/owner/club`): each program, policy and rule as parents would hear it, with *Edit* on each. Changes save as a draft. *Try your changes* on the right, then *Check how this changes answers*: every test conversation your change could affect is replayed on the current version and on your change, and anything that got worse is shown side by side. Then publish.
6. **How it's doing** (`/owner/tests`): a plain verdict ("Doing well"), the answers to look at with what went wrong in one line, *Do you agree with the grading?* to check the grader yourself, and the practice conversations. Scores by area and past checks sit under *Details*. *Write 10 practice conversations about refunds* (or anything else) has a simulated parent write new test conversations; you look them over and keep the ones you agree with.

## Scripts

| | |
|---|---|
| `npm test` | Unit tests for the code that doesn't need a model: the figure check, topic scoping, grading, the before/after verdict and which tests a change reaches, club time, the family card. Free and instant |
| `npm run smoke` | Four of the brief's example messages through the real engine |
| `npm run eval` | A full check of the live assistant, with failures printed. `-- --reps 3` then `-- --reps 3 --against <run id>` is the before/after check for a code change (prompt, model) |
| `npx tsx --env-file-if-exists=.env.local scripts/feedback-check.ts <messageId> <note…>` | The correction loop from the command line: propose, approve, compare |
| `npx tsx --env-file-if-exists=.env.local scripts/write-tests.ts` | Rewrites the simulated-parent tests in `lib/eval/simulated-cases.json` |
| `npx tsx --env-file-if-exists=.env.local scripts/compare-voice.ts` | Speed and quality of the answer settings for phone calls |

Each of these calls the API and costs money (smoke about $0.05, eval about $0.50, feedback-check about $0.75, write-tests about $2, compare-voice about $2).

## Layout

- `lib/engine/` – classify, build the prompt, answer. The only place an answer is produced.
- `lib/db/` – schema, snapshots (draft/live/archived), conversations.
- `lib/eval/` – test cases (hand-written in `cases.ts`, simulated-parent ones in `simulated-cases.json`), the test writer, graders, runner, before/after comparison, grader calibration.
- `lib/feedback.ts` – a plain-words correction becomes a proposed change and a test.
- `lib/review.ts`, `lib/owner-draft.ts`, `lib/teach.ts`, `lib/family.ts` – work done after a message: the second-model review, the owner's drafted reply, lessons from the owner's answers, the family card.
- `app/` – parent chat (`/`), owner pages (`/owner`), API routes for the parent chat.
