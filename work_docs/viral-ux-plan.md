# Viral UX Plan

## Goal

Reach 3-5K MAU to generate ~$100/month from 1% on-chain settlement commissions.

## Revenue Model

- 1% commission on USDT settlements, min $0.10, max $1.00
- Target: $100/month

| Scenario    | On-chain % | Settlements/mo | Avg settlement | Avg commission | MAU needed |
| ----------- | ---------- | -------------- | -------------- | -------------- | ---------- |
| Pessimistic | 3%         | 1.0            | $30            | $0.30          | ~11,100    |
| Middle      | 10%        | 1.5            | $50            | $0.50          | ~1,300     |
| Optimistic  | 20%        | 2.0            | $80            | $0.80          | ~310       |

Realistic target: ~3,000-5,000 MAU (between pessimistic and middle).

## Growth Strategy

### Telegram-native growth loops

- Every group invite is an acquisition event (1 user → 4-6 friends per group)
- Bot DM notifications are re-engagement touchpoints
- Invite friction is near-zero (Telegram deep link, no app store)

### Target audiences (seed first)

| Niche                  | Why                                                 |
| ---------------------- | --------------------------------------------------- |
| Travel groups          | High expense volume, clear settlement moment        |
| Shared apartments      | Recurring monthly use (rent, utilities, groceries)  |
| Event organizers       | One person pays, splits among 10-20 attendees       |
| Freelancer teams       | Already comfortable with crypto payments            |
| TON/crypto communities | Already have wallets, split conference/meetup costs |

### Distribution channels

- TON ecosystem channels, ton.app directory listing
- Partner with TON wallets (Tonkeeper, MyTonWallet)
- Telegram Mini App catalog (when it matures)
- Short Telegram channel with use-case stories
- TON hackathon submissions

### Key metric

**Groups created per week.** Each group is a self-contained viral loop. Target 30% group-creation rate (% of new members who create their own group within 30 days).

---

## UX Improvements

### 1. Post-creation invite nudge

**Priority: 1 | Effort: Small | Impact: High**

**Problem:** User creates group → lands on empty group page. No prompt to invite. Empty groups die.

**Fix:**

- After group creation, show inline card: "Invite friends to start splitting" with share button
- Or auto-open Telegram share dialog — one less tap
- Empty state should make inviting the obvious next action

### 2. Better bot reply on join

**Priority: 2 | Effort: Small | Impact: Medium**

**Problem:** Bot reply after join is wordy. 4 taps from link to group page.

**Current:** "You've joined "Dinner Club"! Open the app to start splitting expenses." + button

**Fix:**

- Minimal, action-oriented reply:

  ```
  ✓ You joined "Dinner Club" (5 members)

  [Open Group →]
  ```

- web_app button deep-links directly to the group, not home
- Ensure seamless transition (no flash, no double-load)

### 3. Better share text with context

**Priority: 3 | Effort: Small | Impact: Medium**

**Problem:** Shared message is a raw bot link with generic text `Join "Dinner Club" on Splitogram!`. No preview card, no reason to tap.

**Fix:**

- Richer share text: `Join "Dinner Club" on Splitogram — split expenses and settle up instantly 💸`
- Add member count teaser: `"4 people already splitting expenses"`
- Set bot description + short_description via BotFather for link previews

### 4. First-time user welcome + CTA

**Priority: 4 | Effort: Small | Impact: Medium**

**Problem:** New user joins via invite → sees group with expenses they weren't part of. Cold landing, no guidance.

**Fix:**

- Show toast/banner: "You joined! Add your first expense to get started."
- Highlight or pulse the "Add Expense" button for first-time users
- If group has placeholder members, claim prompt should appear immediately and prominently

### 5. Post-settlement share moment

**Priority: 5 | Effort: Medium | Impact: Medium**

**Problem:** Settlement completes → notification to both parties. Missed opportunity for social proof.

**Fix:**

- After marking settled, show shareable summary: "Settled $42.50 with @alex in Dinner Club ✓"
- "Share to group chat" button — lets the group know debts are being paid
- Social proof drives trust + reminds others to settle

### 6. Random placeholder names + personalized claim links

**Priority: 6 | Effort: Medium | Impact: High**

**Problem:** Placeholders are boring ("Placeholder 1"). Invite button shares a generic link with no hook.

**Idea: Name dice on placeholder creation**

- When admin creates a placeholder, auto-generate a random funny name from two dice:
  - "Good" dice (adjectives): Mighty, Lucky, Brave, Cosmic, Golden, Chill, Epic, Noble, Swift, Jolly, ...
  - "Bad" dice (nouns): Walrus, Penguin, Raccoon, Goblin, Potato, Noodle, Pickle, Wombat, Cactus, Burrito, ...
- Result: "Mighty Walrus", "Chill Potato", "Epic Raccoon"
- Admin can still rename, but the random name is the fun default
- These names show up in expense splits, making the group feed entertaining

**Personalized claim deep link**

- New deep link pattern: `claim_{groupId}_{placeholderId}`
- Example: `https://t.me/splitogram_bot?start=claim_42_99`
- Share text: `"Chill Potato owes $25 in 'Bali Trip' — is that you?! 🥔"`
- When recipient taps the link:
  1. Bot/app opens with claim context
  2. Shows: "Chill Potato is invited to Bali Trip — is that you?!"
  3. One tap to claim → merges placeholder into real user
- The curiosity factor ("who named me Chill Potato?!") drives tap-through
- Even if the recipient doesn't claim, they'll open the app out of curiosity

**Why this is viral:**

- The funny name is inherently shareable — people screenshot and share in group chats
- Creates inside jokes within friend groups
- The personalized "is that you?!" message has much higher open rate than generic invites
- Low effort for admin (no need to type real names for people not on the app yet)

### 7. "Shame Board" leaderboard

**Priority: 7 | Effort: Medium | Impact: High**

**Idea:** Tongue-in-cheek ranking of biggest debtors in the group.

- "Hall of Shame 🏆" section on group page:
  - `#1 Chill Potato — owes $127.50`
  - `#2 Epic Raccoon — owes $42.00`
- Shareable as an image/card to the group chat
- Nobody wants to be #1 — social pressure to settle up (settlements = commission revenue)
- Flip side: "Hall of Fame" for people who settle fastest or most consistently
- Generates screenshots shared organically in group chats

### 8. "IOU Receipt" shareable card

**Priority: 8 | Effort: Medium | Impact: High**

**Idea:** After an expense is added, generate a visual receipt card.

```
┌──────────────────────────┐
│  🧾 SPLITOGRAM RECEIPT   │
│                          │
│  Groceries     $45.00    │
│  Bali Trip · 3 people    │
│                          │
│  You owe @dmitry $15.00  │
│  ─────────────────────── │
│  [Settle up →]           │
└──────────────────────────┘
```

- Shareable to group chat as an image
- Every share is free branded advertising
- Could be auto-generated and sent via bot to the group chat
- Works as a notification format too — visual > plain text

### 9. "Trip Wrap" summary

**Priority: 9 | Effort: Medium | Impact: High**

**Idea:** Spotify Wrapped-style summary when a group settles all debts to zero, or monthly for ongoing groups.

- Triggered when all balances hit zero, or on-demand / monthly
- Stats: total expenses, total amount, duration, biggest spender, most frequent payer, most common category
- Example:
  ```
  🌴 Bali Trip — WRAPPED
  23 expenses · $2,340 total · 47 days
  💰 Biggest spender: Chill Potato ($890)
  🏃 Fastest settler: @alex (2 min avg)
  🍕 Most common: Food ($1,200)
  ```
- Colorful, shareable card — people post these on social media after trips
- Monthly wraps for apartment groups keep engagement alive

### 10. Expense emoji reactions

**Priority: 10 | Effort: Small | Impact: Medium**

**Idea:** Let group members react to expenses with emoji.

- Quick reactions: 😱 (expensive!), 🤦 (again?!), 🎉 (worth it!), 👍 (fair), 🔥 (nice)
- Show reaction counts on expense items in the feed
- Tiny feature but creates micro-engagement loops — people open the app to see reactions
- Reactions on "Chill Potato bought 47 energy drinks — $94" become inside jokes
- Low effort: just a reactions table (expense_id, user_id, emoji) + UI chips

### 11. "Split Roulette" — who pays next

**Priority: 11 | Effort: Small | Impact: Medium**

**Idea:** Fun randomizer for who picks up the next bill.

- Button in group: "Who's buying next? 🎲"
- Animated wheel/dice roll
- Weighted by current balances — whoever owes most has highest chance of being picked
- Result: "The wheel has spoken: Mighty Walrus pays for dinner tonight 🎰"
- Shareable result card to group chat
- Drives real-world usage of the app at restaurants/bars — "let the app decide"

### 12. "Debt Birthday" escalating reminders

**Priority: 12 | Effort: Small | Impact: Medium-high**

**Idea:** Playful guilt-trip notifications as debts age.

- Milestone bot DMs with escalating humor:
  - **7 days:** "Your $25 debt to @alex just turned a week old 📅"
  - **30 days:** "Your debt to @alex is 30 days old today 🎂 Time to settle?"
  - **60 days:** "This debt is older than most TikTok trends 👴"
  - **90 days:** "Your debt can legally drive in some countries 🚗"
  - **180 days:** "Historians are starting to study this debt 📜"
- Opt-out via existing mute toggle (respects group_members.muted)
- Each notification has a "Settle up →" button — direct path to revenue
- Drives settlements without being annoying (infrequent, funny tone)
- Recipients screenshot the funny ones and share — organic reach

### 13. Bot profile polish

**Priority: 13 | Effort: Tiny | Impact: Low-medium**

**Fix:**

- Set a recognizable bot avatar (not Telegram default)
- Bot about text: "Split expenses. Settle in USDT." (short, clear)
- Bot description: shown when someone opens the bot for the first time — explain value prop in 2 lines

### 14. Group chat bot integration (future)

**Priority: 14 | Effort: Large | Impact: Very high**

**Fix (build later):**

- Allow adding bot to Telegram group chats
- `/split` command in group chat → opens Mini App with that group pre-selected
- Bot posts expense summaries to chat: "@dmitry added 'Groceries' — $45 split 3 ways"
- Makes expenses visible without opening the app — massive engagement driver

---

## Implementation Order

### Phase A — Quick wins (small effort, no new infra)

1. Bot profile polish (BotFather config, no code)
2. Post-creation invite nudge
3. Better share text with context
4. Better bot reply on join
5. First-time user welcome + CTA

### Phase B — Engagement & social pressure

6. Random placeholder names + personalized claim deep links
7. Expense emoji reactions
8. Debt birthday escalating reminders
9. Split roulette

### Phase C — Shareable content (branded viral loops)

10. IOU receipt shareable cards
11. Shame board leaderboard
12. Post-settlement share moment
13. Trip wrap summaries

### Phase D — Platform integration (large effort)

14. Group chat bot integration
