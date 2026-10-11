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

1. **Talk to it as a parent** at `/`. Try the hard ones: "info?", "Coach Mike yelled at my daughter", "can someone just call me". Switch to a call partway through; it remembers the texts.
2. **Inbox** (`/owner`): conversations that need you come first. That means ones the assistant handed to you, with the reason, and ones holding a reply the second-model review doubts. Reply yourself; the parent sees it in the same chat.
3. **Fixing a reply.** On a flagged reply click *Fix it*: the correction is pre-written, edit it if you like. On any other reply, *Something wrong with this reply?* does the same. You'll see the proposed fix and a new test in plain words. *Looks right - check it* adds it to your unpublished changes and starts the before/after check; when it says *Safe to publish*, publish from right there.
4. **Club details & rules** (`/owner/club`): edit prices, schedules and rules. Changes save as a draft. *Try your changes* on the right, then *Check how this changes answers*: every test conversation is replayed on the current version and on your change, and anything that got worse is shown side by side. Then publish.
5. **How it's doing** (`/owner/tests`): the latest score, every answer with the grader's reasons, the list of tests, and *Spot-check the grader* to see whether you agree with it.

## Scripts

| | |
|---|---|
| `npm run smoke` | Four of the brief's example messages through the real engine |
| `npm run eval` | A full check of the live assistant, with failures printed |
| `npx tsx --env-file-if-exists=.env.local scripts/feedback-check.ts <messageId> <note…>` | The correction loop from the command line: propose, approve, compare |

Each of these calls the API and costs money (smoke about $0.05, eval about $0.20, feedback-check about $0.75).

## Layout

- `lib/engine/` – classify, build the prompt, answer. The only place an answer is produced.
- `lib/db/` – schema, snapshots (draft/live/archived), conversations.
- `lib/eval/` – test cases, graders, runner, before/after comparison, grader calibration.
- `lib/feedback.ts` – a plain-words correction becomes a proposed change and a test.
- `app/` – parent chat (`/`), owner pages (`/owner`), API routes for the parent chat.
