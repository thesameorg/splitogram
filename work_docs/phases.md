# Splitogram — Business Phases

Phased roadmap from testnet prototype to full product. Each phase has a clear goal, deliverables, scope boundaries, and success criteria.

---

## Phase 1: Testnet Prototype (V1) — IN PROGRESS (~30%)

**Goal:** Prove the full cycle works end-to-end on TON testnet with a real group dynamic — expense tracking, notifications, debt calculation, and on-chain settlement — all with fake money.

**Current status (2026-02-18):** Infrastructure layer complete — auth, sessions, DB schema, bot webhook, debt solver algorithm, local dev setup with ngrok tunnel. All API business logic (groups, expenses, balances, settlements) and the entire frontend (pages, routing, components) are not yet implemented. See `work_docs/phase_1/README.md` for detailed task status.

**Deliverables:**

- Telegram Mini App shell with TG Web App auth (zero-signup entry)
- Manual group creation: user creates a group, invites members (Splitwise-style, not tied to TG group chats)
- Group join flow: invite link → recipient taps → joins group in one step
- 1-on-1 balances (two people, no group needed)
- Add expenses with equal splits among selected members
- "Who was involved" selector — not everyone in the group needs to be in every expense
- Debt graph calculation with optimization (minimize number of transactions)
- TON Connect wallet linking (Tonkeeper, MyTonWallet, Telegram Wallet, etc.)
- "Settle up" flow: service builds testnet USDT transfer → user approves in wallet
- On-chain verification of settlement on testnet (track tx hash via TONAPI)
- "Mark as settled externally" fallback for testers without wallets
- Basic expense list and balance overview per group
- TG bot notifications:
  - New expense added
  - Settlement completed (on-chain or external)
  - New group invitation
- Inline buttons in bot messages to open the mini app directly
- Deep links: tap a notification → land on the specific group/debt in the mini app

**Scope boundaries:**

- Testnet only — no real money
- USDT only (adapter pattern under the hood for future currencies)
- Equal splits only — no percentages, no custom amounts (but "who was involved" is supported)
- Bot is notification-only — no expense creation via bot commands
- No file attachments
- No viral/referral mechanics yet

**Success criteria:**

- A user can: create group → add expense → others get notified → debtor taps "settle up" → approves testnet tx → debt auto-marks as settled → group notified
- Non-wallet users can mark debts as settled externally
- Full cycle demonstrated to stakeholders / early testers in a real group setting (not solo)

---

## Phase 2: Mainnet Launch

**Goal:** Go live with real USDT on TON mainnet. Real money, real stakes.

**Deliverables:**

- Switch settlement from testnet to mainnet USDT
- Pre-flight balance check before settlement attempts (via TONAPI)
- Payment state machine: `open → payment_pending → settled` with rollback to `open` on failure
- Background reconciliation job: on startup and on cron, query TONAPI for all tx hashes in `payment_pending` state and resolve their outcomes
- Clear error UX: insufficient balance, tx rejected, tx timeout
- "How to get USDT" guidance for users with empty wallets (link to MoonPay / Telegram Wallet top-up)
- Rate limiting on settle endpoint (per user per debt)
- Debt is never marked settled until on-chain confirmation — non-negotiable
- Unequal splits: exact amounts per person (beyond equal splits from Phase 1)
- Balance summary across all groups on the home screen

**Scope boundaries:**

- No transaction fees yet
- No partial payments
- No multi-currency — USDT only
- No percentage/ratio splits yet

**Success criteria:**

- First real USDT settlement processed and verified on-chain
- Zero false "settled" states — payment verification is airtight
- Failure scenarios handled gracefully (user always knows what happened)
- Reconciliation job correctly resolves stale `payment_pending` states

---

## Phase 3: Retention & Trust

**Goal:** Make users come back. Build confidence that the app is reliable and useful beyond one-time use.

**Deliverables:**

- Rich expense history and activity feed per group
- Group activity timeline (who added what, who settled when)
- Debt reminders — nudge debtors via bot with a friendly "you owe X to Y"
- Reminder scheduling (cron-based, configurable frequency)

**Scope boundaries:**

- No file attachments yet
- No analytics or dashboards
- No export

**Success criteria:**

- 30-day group retention measurable and improving
- Reminder → settlement conversion rate tracked

---

## Phase 4: Advanced Splitting

**Goal:** Handle real-world expense complexity beyond equal and exact-amount splits.

**Deliverables:**

- Percentage-based splits
- Custom ratios (e.g., 2:1:1)
- Expense categories (food, transport, accommodation, etc.)
- Attach photos/files to expenses and settlements (receipts, proof)

**Scope boundaries:**

- No recurring expenses yet
- No multi-currency
- Categories and advanced splits are candidates for premium gating — decide before shipping (see Open Decisions)

**Success criteria:**

- Covers the vast majority of real splitting scenarios (dinner where someone had drinks, rent split 60/40, etc.)
- Category data collected for future analytics

---

## Phase 5: Growth & Virality

**Goal:** Organic user acquisition through social mechanics and reduced friction.

**Deliverables:**

- Optimized invite flow: polish the link-based join experience from Phase 1
- Social proof in chats: "Alice settled $12.50 with Bob" visible to group
- Shareable expense summaries (e.g., "Trip to Bali — total $2,400 split among 4 people")
- Onboarding polish: first-time user experience, tooltip walkthrough
- Referral program (details TBD based on traction data)

**Scope boundaries:**

- No paid acquisition
- No cross-promotion with other apps

**Success criteria:**

- Measurable viral coefficient (new users brought in per existing user)
- Invite → active user conversion rate tracked and improving

---

## Phase 6: AI Features

**Goal:** Reduce friction in expense entry — the #1 chore in any expense tracker.

**Deliverables:**

- AI receipt scanning: snap a photo → app extracts merchant, amount, date, items
- Auto-suggest split based on receipt items ("Alice had the salad, Bob had the steak")
- Auto-categorization of expenses based on merchant/description
- Quick-add: natural language expense entry ("dinner 45 split with alice and bob")

**Scope boundaries:**

- Receipt scanning accuracy doesn't need to be perfect — editable results are fine
- No accounting integrations

**Success criteria:**

- Photo → parsed expense in under 5 seconds
- Users prefer scanning over manual entry (measured by usage ratio)

---

## Phase 7: Multi-Currency

**Goal:** Support international groups where people deal in different currencies.

**Deliverables:**

- Multiple currencies per group (both fiat and crypto)
- Exchange rates updated via cron (adapter architecture from Phase 1 pays off)
- Expense in any supported currency, settlement always in USDT on TON
- Clear conversion display: "You owe $30 (≈ 30.02 USDT at current rate)"
- Support TON coin as an additional settlement currency alongside USDT

**Scope boundaries:**

- No real-time rate locking — rates update periodically, small slippage accepted
- No fiat settlement — on-chain only

**Success criteria:**

- Groups with mixed-currency expenses can operate without confusion
- Rate discrepancy complaints are minimal

---

## Phase 8: Monetization

**Goal:** Generate revenue. Introduce premium tier after product-market fit is proven.

**Deliverables:**

- Premium subscription (~$3-5/month)
- Payment via Telegram Stars or USDT
- Gated premium features:
  - AI receipt scanning
  - Multi-currency support
  - Expense categories and analytics
  - Unlimited group size
  - CSV/PDF export
- Optional transaction fee (0.1-0.3%) introduced if settlement volume justifies it

**Scope boundaries:**

- Free tier remains fully functional for basic use (unlimited groups, up to 10 members, all split types, USDT settlement)
- No ads — ever

**Success criteria:**

- Premium conversion rate tracked
- Revenue per user metrics established
- Free tier remains compelling enough to drive growth

---

## Phase 9: Platform Expansion

**Goal:** Evolve from expense splitter into a full group finance tool.

**Deliverables:**

- Recurring expenses (rent, subscriptions) with auto-reminders
- Partial payments ("pay $10 of your $30 debt now")
- Analytics dashboard (spending by category, group trends, personal spending patterns)
- CSV/PDF export for groups and individuals
- Data export and account deletion (GDPR compliance)

**Scope boundaries:**

- No budgeting or savings features
- No integration with external accounting tools

**Success criteria:**

- Feature parity with Splitwise Pro — plus on-chain settlement as the differentiator
- User engagement metrics show platform stickiness beyond casual use

---

## Phase Summary

| Phase | Name                   | Key Milestone                            | Dependency                                        |
| ----- | ---------------------- | ---------------------------------------- | ------------------------------------------------- |
| 1     | Testnet Prototype (V1) | Full cycle on testnet with notifications | —                                                 |
| 2     | Mainnet Launch         | First real USDT settlement               | Phase 1                                           |
| 3     | Retention & Trust      | 30-day retention baseline                | Phase 2                                           |
| 4     | Advanced Splitting     | Real-world expense coverage              | Phase 2                                           |
| 5     | Growth & Virality      | Viral coefficient measured               | Phase 3                                           |
| 6     | AI Features            | Receipt scanning live                    | Phase 4 (soft — basic scanning can start earlier) |
| 7     | Multi-Currency         | International groups supported           | Phase 4                                           |
| 8     | Monetization           | Revenue stream active                    | Phase 6, 7                                        |
| 9     | Platform Expansion     | Full group finance tool                  | Phase 8                                           |

---

## Open Decisions (to resolve as we go)

- **Split types as free or premium** — All split types (equal, exact, percentage, ratio) are free. Premium is built around AI, multi-currency, analytics, and export. This avoids the "take features away" problem. Revisit if data suggests otherwise.
- **Referral program details** — design when Phase 5 is scoped
- **Transaction fee threshold** — introduce in Phase 8 only if volume justifies it
- **TON coin settlement** — planned for Phase 7 alongside multi-currency
- **Premium pricing** — $3 vs $5/month, to be validated with early users before Phase 8
- **Free tier group size** — 10 members may be too restrictive for event groups. Consider 20-25. Validate with real usage data.
- **Data retention policy** — needs to be defined before Phase 5 (growth brings users from various jurisdictions)
