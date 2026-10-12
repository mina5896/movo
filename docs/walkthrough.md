# Walkthrough script (about 5 minutes)

A suggested order for recording a demo. Start from `npm run dev` with a seeded database.

1. **The parent's side (1 min).** Open `/`, enter a first name, and ask "do u have anything sat morning for 2 kids, 5 and 7". Point out: correct programs, the 9:00 class being full, the sibling discount, no pressure. Then click 📞 and say "can someone just call me". It continues the same conversation by voice and asks for a number.
2. **Tonight's weather (30 s).** In *Club details & rules*, post the notice "Tonight's practice is CANCELLED because of the weather". As the parent, ask "is there practice tonight its pouring": it says it's cancelled. Take the notice down afterwards.
3. **A hard case (30 s).** Text "Coach Mike yelled at my daughter at practice". It's warm, doesn't take sides, and hands off.
4. **The owner's inbox (30 s).** Open `/owner`. The coach conversation is at the top with the reason. Open it, show the text and call turns in one thread, reply as the owner, and show the reply appear in the parent chat.
5. **It points you at doubtful answers (1 min).** Every reply to a parent is double-checked by a second model. A doubtful one moves the conversation to *Needs you* with the concern in plain words. Open it, click *Fix it* (the correction is already written as a suggestion), then *Suggest a fix*. Show the proposed change and the new test, and click *Looks right - check it*. The before/after check starts by itself. Come back to a plain "✓ Safe to publish" and publish from the same place. (Under any reply, *Something wrong with this reply?* does the same for mistakes the reviewer missed.)
6. **Checking a change before parents see it (1.5 min).** Open *Club details & rules* and change the summer camp dates. Use *Try your changes* to ask about camp. Click *Check how this changes answers* and show the before/after page: what got better, what (if anything) got worse, side by side. Then publish.
7. **Trusting the scores (30 s).** Open *How it's doing*: the score per category and the list of tests, including the ones that came from corrections. Open *Spot-check the grader* and label one answer.

Close on the main point: the owner doesn't hunt for mistakes, and doesn't need to understand the assistant to fix one. They read a flag, write a sentence, and publish when it says it's safe. Every change is checked against every past mistake first.
