# Take-home assignment: an assistant for Riverside Kickers

This assignment describes a problem rather than a specification. Parts of it are deliberately open to interpretation. Where something is unclear, make a reasonable decision, record it and continue.

The problem is also larger than can be solved in the time available, and scoping it is part of the exercise. Decide what will deliver the most value to the owner and to parents, and build that first. A smaller system that works end to end is worth more than a complete design that is only partly built. Record what you left out and why.

## The situation

Riverside Kickers is a youth soccer club with about 300 players aged 3 to 14. Its owner answers every text and phone call personally. Most parents ask one of a few dozen recurring questions: what a program costs, whether there is space on Saturday, which group suits their child, or whether practice will go ahead in the rain. When a new family waits a day for a reply, it often joins another club instead.

The owner tried a chatbot last spring and switched it off after a month, but still wants an assistant that answers parents on the club's behalf, provided it can be trusted.

## What parents need

Parents expect a prompt, correct answer by text at any time of day. Some would rather speak to someone. A parent who starts by text and then asks for a call, or calls the club directly, should not have to repeat anything; the same applies in the other direction.

The assistant must not invent answers. When it does not know something, or when a person should handle the matter, it should say so, involve the owner and tell the parent what will happen next.

## What the owner needs

The owner needs a single view of each family's conversation, whether it took place by text or by phone, that shows which conversations require their attention.

Club details change regularly. Prices rise, the schedule changes each season and fields close. The owner needs to make these updates without technical help, and has rules for how the assistant should behave, such as "do not promise a spot until it has been paid for" or "always mention the free trial."

## Trying the assistant and improving it

The owner will not trust the assistant with families until they have used it themselves. They want to talk to it as a parent would, by text and by voice, and to try the difficult cases as well as the easy ones: a vague question, an upset parent, a request it cannot handle.

The owner's test is whether the assistant represents the club well. Its answers should be correct, follow the owner's rules, pass the right matters to the owner and sound like the club. The owner wants a way to tell how well the assistant meets that standard across many conversations, not only the one in front of them.

When an answer falls short, in a test conversation or a real one, the owner wants to say what was wrong or what it should have said, in plain words and without understanding how the assistant works. The assistant should improve as a result, and the owner should not have to correct the same mistake twice.

Above all, a change must not cause unexpected harm, which is why the previous chatbot was switched off. After the owner updated the summer camp dates, it continued to give parents the old dates for a week. After a note about the late-pickup fee was added, it began mentioning fees in unrelated conversations. Before a change reaches parents, the owner wants to see how it will affect the answers they receive. The owner will try some changes personally, but testing each change by holding thirty conversations by hand is not practical.

## Notes

Real phone numbers are optional. A simulated text conversation and a voice conversation in the browser are sufficient. The club details at the end of this document describe the club as it is today, and the owner will change them. Any language, framework, model or AI coding tool may be used.

## What we will look for

We will look for a system that works end to end for both a parent and the owner, and for the reasoning behind your scope. The most important part is how well the owner can judge the assistant, correct it and trust that each change helps.

## About Riverside Kickers

### Programs

| Program | Ages | Schedule | Price |
|---|---|---|---|
| Little Kicks | 3-5 | Saturdays, 9:00-9:45am or 10:00-10:45am | $120 per 8-week session |
| Rec League | 6-10 | Tuesdays and Thursdays, 5:00-6:15pm; games on Saturdays | $240 per season |
| Travel Teams | 9-14 | Practice three times a week; weekend games; tryout required | $95 per month, plus an $85 uniform |
| Summer Camp | 5-12 | Monday to Friday, 9am-3pm, June 21 to August 13 | $310 per week |

The 9:00 Little Kicks class is currently full and has a waitlist. Fall tryouts for the travel teams have finished; the next tryouts are in January.

### Policies

| Policy | Detail |
|---|---|
| Free trial | One free class for Little Kicks and Rec League. No trial for Travel Teams. |
| Siblings | 10% off for each additional child. |
| Refunds | Full refund before the first class. After that, credit toward a future session and no cash refund. |
| Weather | The owner decides two hours before the start time and texts every family either way. |
| Late pickup | $1 per minute after the first 10 minutes. |
| Location | Riverside Park fields, 400 River Road. |
| Tone | Replies are short and friendly and use the parent's first name. The club never pressures a family to sign up. |
| Handled by the owner | Injuries, payment disputes, financial aid and any concern about a specific coach. |

### Example messages from parents

> hi how much is soccer for a 4 yr old

> is there practice tonight its pouring

> my son did rec last year can he try out for travel? hes 9 but turns 10 in march

> can someone just call me, easier to explain

> we paid for spring but we're moving in april. can we get our money back

> do u have anything sat morning for 2 kids, 5 and 7

> Coach Mike yelled at my daughter at practice and now she doesn't want to go back
