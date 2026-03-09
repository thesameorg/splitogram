# Split Bill on TON — Business Overview

## One-liner

Splitwise-style group expense tracker inside Telegram with actual instant settlement via USDT on TON.

---

## Problem

Splitting expenses among friends is a universal pain point. Existing solutions either:

- **Track but don't settle** — Splitwise, SplitFast (TG bot) calculate who owes what, but then you still need Venmo/PayPal/bank transfer to actually pay. Extra friction, especially cross-border.
- **Settle but don't track** — Telegram's `@push 1 USDT` lets you send money in chat, but there's no concept of shared expenses, group balances, or debt optimization.
- **Are dead hackathon prototypes** — TON-Splitter, Split!, TeleSplit all attempted this at hackathons but never shipped a real product.

The gap: **nobody combines expense tracking + on-chain settlement in a polished Telegram Mini App.**

## Why now

- **TON Pay launched Feb 11, 2026** — USDT payments in mini apps, fees < $0.01, sub-second settlement. Micro-settlements are now economically viable.
- **MoonPay cross-chain deposits** (Feb 12, 2026) — users can fund TON Wallet with BTC/ETH, lowering the onramp barrier.
- **TON is the exclusive blockchain** for Telegram mini apps since Feb 2025. No fragmentation.
- **1.43B USDT supply** on TON — liquidity is there.
- **SplitFast explicitly doesn't do payments** — "We're focused on tracking, not processing payments." They've conceded the settlement layer.

---

## Target audience

1. **Primary:** Crypto-native friend groups already on Telegram (CIS, SEA, MENA) who travel together, share apartments, go out to eat. They already have TON wallets.
2. **Secondary:** International groups where traditional payment rails (Venmo, PayPal) don't work across borders. USDT on TON is borderless by default.
3. **Tertiary:** Telegram communities organizing events, group buys, shared subscriptions.

## User flow (MVP)

1. User opens the mini app from a Telegram group chat
2. Authenticates via TG Web App auth (zero friction — no signup)
3. Adds an expense: "Dinner — $45 — paid by @dmitry — split between @alice, @bob, @dmitry"
4. App calculates optimal debt graph (minimizes number of transactions)
5. Debtors see a "Settle up" button → connects TON wallet via TON Connect
6. **Service constructs the transaction** (exact amount, recipient address, unique memo) → user approves in their wallet
7. Payment confirmed on-chain (tracked by tx hash) → debt marked as settled automatically
8. Group members get TG bot notifications on expenses and settlements

### Settlement architecture

The service controls transaction creation, not the user. This makes payment verification deterministic:

1. User taps "Settle up" → service builds the USDT Jetton transfer payload (recipient, amount, memo)
2. Payload sent to user's connected wallet via TON Connect for approval
3. User approves → wallet signs & broadcasts → service receives tx hash
4. Service verifies the specific tx hash on-chain via TONAPI
5. On confirmation: debt state transitions `open → settled`, group notified

**Supported wallets:** Any TON Connect-compatible wallet — Tonkeeper, MyTonWallet, Telegram Wallet, etc. Telegram Wallet is treated as one of N wallet options, not a competitor.

**Failure handling:**

- Insufficient USDT balance → pre-flight check via TONAPI, block attempt with clear message
- Tx rejected or times out → debt stays `open`, user sees "payment failed, try again"
- Debt is never marked settled until on-chain confirmation lands
- State machine: `open → payment_pending → settled`, with `payment_pending → open` as rollback

## Competitive landscape

| Product                   | Tracking              | Settlement             | TON/Crypto | Telegram-native | Status              |
| ------------------------- | --------------------- | ---------------------- | ---------- | --------------- | ------------------- |
| **Splitwise**             | ✅ Excellent          | ❌ External            | ❌         | ❌              | Active, 100M+ users |
| **SplitFast**             | ✅ Good + AI receipts | ❌ Explicitly excluded | ❌         | ✅ TG Mini App  | Active              |
| **Telegram Wallet**       | ❌ None               | ✅ P2P USDT            | ✅         | ✅ Native       | Active              |
| **TON-Splitter**          | ⚠️ Basic              | ✅ TON/Tonkeeper       | ✅         | ✅ Bot          | Dead (hackathon)    |
| **Split!** (DoraHacks)    | ⚠️ Basic              | ✅ TON/Tonkeeper       | ✅         | ✅ Bot + WebApp | Dead (hackathon)    |
| **TeleSplit** (ETHGlobal) | ⚠️ Basic              | ✅ USDC (EVM)          | ⚠️ Not TON | ✅              | Dead (hackathon)    |
| **Our project**           | ✅                    | ✅ USDT on TON         | ✅         | ✅              | Planned             |

**Key insight:** SplitFast is the only active competitor in TG, and they've explicitly chosen not to do payments. Telegram Wallet does payments but has zero expense tracking — it's a wallet, not a Splitwise. We own the "tracking + settlement" intersection. Telegram Wallet is complementary — we use it as one of the supported wallet options via TON Connect.

---

## Revenue model

### Free tier

- Unlimited groups, up to 10 members per group
- Single currency per group
- Basic expense splitting (equal, exact amounts)

### Premium (~$3-5/month, paid in Stars or USDT)

- Multi-currency with auto-conversion
- AI receipt scanning (photo → expense via GCloud Vision)
- Percentage-based splits, custom ratios
- Expense categories and analytics
- Unlimited group size
- Export to CSV/PDF

### Transaction fee (optional, later)

- 0.1–0.3% on settlements at scale (much lower than any fiat rail)
- Can be introduced once there's enough volume to matter

### Revenue potential

- Splitwise has 100M+ users and makes money purely on premium subscriptions
- Even capturing 0.1% of Telegram's 500M mini app users at $3/month = significant

---

## Risks & mitigations

| Risk                                        | Severity    | Mitigation                                                                                                                         |
| ------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Users don't have TON wallets / USDT         | Medium      | MoonPay onramp just launched; Telegram Wallet as easiest option; also support TON native alongside USDT                            |
| SplitFast adds payments                     | Medium      | Ship fast, build switching costs via history and group data. Most direct competitive threat.                                       |
| Telegram adds expense splitting to Wallet   | Low         | Wallet ≠ Splitwise. Different product category. Mitigate by shipping fast and building data lock-in (expense history, group data). |
| Low crypto interest (Google Trends at lows) | Low         | Target existing crypto users, not onboarding normies                                                                               |
| Compliance / AML at scale                   | Low for MVP | P2P transfers between known friends; no custodial role; revisit at scale                                                           |
| Smart contract risk                         | None        | No custom smart contracts — uses standard Jetton transfers                                                                         |

---

## MVP scope (4–6 weeks)

### Must have (v1)

- TG Web App auth
- Create/join expense groups (linked to TG group chats)
- Add expenses with simple equal splits
- Debt calculation with optimization (minimize transactions)
- TON Connect wallet linking (Tonkeeper, MyTonWallet, Telegram Wallet, etc.)
- "Settle up" flow: service-created USDT transactions via TON Connect
- On-chain payment verification (deterministic — track tx hash via TONAPI)
- Pre-flight balance check before settlement attempts
- "Mark as settled externally" fallback for users without wallets
- Basic expense history
- TG bot notifications for new expenses and settlements
- Inline buttons to open mini app from group chat

### Nice to have (v1.1)

- AI receipt scanning
- Multi-currency support (both fiat and crypto rates, updated by cron)
- Unequal splits
- Attach files/photos to spendings and settlements

### Later (v2+)

- Partial payments
- Recurring expenses (rent, subscriptions)
- Integration with Kickstarter-on-TON (group fundraising → expense tracking)
- Premium subscription via Stars
- Analytics dashboard

---

## Key metrics to track

- Groups created per week
- Expenses logged per group per month
- % of debts settled on-chain vs. marked as "settled externally"
- Time from expense creation to settlement
- Retention: groups active after 30 days
- Premium conversion rate

---

## Open questions

1. Support TON coin alongside USDT, or USDT only?
2. Should the app work in DMs (1-on-1 splits) or groups only?

---

## Decisions

- **Invoice visibility:** Doesn't matter much, but definitely not wider than the group (visible to group members only).
- **Payer not on Telegram:** Don't handle — these are side-settlements. We allow marking them as settled externally.
- **Partial payments:** Deferred to later versions.
- **Tax receipt generation:** No. Out of scope.
- **Attachments:** Support attaching files/photos to both spendings and settlements.
- **Wallet approach:** Service creates transactions, user only approves. Telegram Wallet is one of N supported TON Connect wallets, not a competitor.
- **Payment verification:** Deterministic — service tracks tx hash from TON Connect, verifies on-chain. No scanning for anonymous transfers.
- **Payment failure handling:** Pre-flight balance check; debt never marked settled until on-chain confirmation; state machine `open → payment_pending → settled` with rollback.
- **No-wallet users:** Track their debts normally, allow "mark as settled externally" for off-chain settlement.
- **Bot notifications:** Must-have for v1 — this is the viral distribution engine, not a nice-to-have.
- **Settlement messages in chat:** Yes — bot posts settlement confirmations to the group chat.
