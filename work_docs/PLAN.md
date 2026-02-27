# Splitogram — Business Phases

Phased roadmap from prototype to full product. Each phase has a clear goal, deliverables, scope boundaries, and success criteria.

**Core insight (from Phase 1 testing):** Make Splitwise-on-Telegram work well first. Crypto settlement is the differentiator, but it means nothing if the core expense tracking UX is rough. Ship a solid expense splitter, then layer on-chain settlement on top.

---

## Phase 1: Core Prototype — DONE

**Goal:** Prove the core loop — create group, add expenses, see balances, invite friends — works inside Telegram as a Mini App.

**What was built:**

- Telegram Mini App with TG Web App auth (zero-signup entry)
- Group creation, invite via link, join via bot deep link
- Add expenses with equal splits and "who was involved" selector
- Debt graph calculation with optimization (minimize transactions)
- Balance overview per group and across all groups
- Bot notifications (expense added, member joined, settlement)
- Deep link routing (bot → mini app at correct screen)
- CI/CD pipeline (GitHub Actions → Cloudflare Workers + Pages)
- TON Connect wallet integration + on-chain settlement (basic, testnet) — **functional but deferred to Phase 3 for polish**

**What was learned (manual testing):**

- Core expense tracking works but UX needs significant polish
- Settlement should work without crypto — manual "mark as settled" by either party
- Missing CRUD: no edit expense, no delete group, no group settings, no leave group
- Bot env var issue (`PAGES_URL` empty) breaks all bot replies — deployment config fix needed
- Notification on every expense is too noisy — needs batching or throttling
- UI issues: redundant buttons, unclear labels, missing owner indicators

See `work_docs/phase-1-summary.md` for detailed findings.

---

## Phase 2: Splitwise Polish (planned at ./todo_phase_2/)

**Goal:** Make the expense splitting experience solid and complete — the app people actually want to use daily. No crypto, just a great Splitwise clone inside Telegram.

**Deliverables:**

- **Bug fixes:**
  - Fix `PAGES_URL` deployment (bot replies currently broken)
  - Fix "please open in Telegram" on first open after redeploy
  - Fix creditor "mark as settled" button being disabled
- **Manual settlement rework:**
  - Either party (debtor OR creditor) can mark a debt as settled
  - Settlement with optional comment (e.g., "paid via bank transfer")
  - Remove crypto settlement UI for now (no wallet connect, no USDT references)
  - Settlement creates a record visible in group activity
- **Expense management:**
  - Edit expense after creation (amount, description, participants)
  - Delete expense
- **Group currency:**
  - Each group has a currency (e.g., USD, EUR, THB, VND) — set at creation, editable in settings
  - All expenses in the group are in that currency
  - Display amounts with correct currency symbol/code
  - Default: USD. Predefined list of common currencies (no need for full ISO 4217)
  - Purely cosmetic in Phase 2 — no exchange rates, no on-chain implications yet
- **Group management:**
  - Group settings page (rename, description, currency)
  - Delete group (creator only)
  - Leave group (with handling of outstanding balances)
  - Group owner indicator in UI
  - Emoji avatar for groups (optional nice-to-have)
- **UX fixes (from testing):**
  - "You owe" / "Owes you" labels instead of third-person names on settle screen
  - Single "Create" button on add expense (TG MainButton only, remove in-page button)
  - Simplify deep links — merge `join` and `group` into one smart handler
  - Join deep link should open the mini app after joining (not just send bot message)
- **Notification improvements:**
  - Don't notify on every single expense — batch or summarize
  - Or: make notifications configurable per group (mute option)
- **Amount display:**
  - Show amounts in the group's currency (e.g., "$15.00", "€12.00", "₫350,000")
  - Drop all USDT labeling from the UI

**Scope boundaries:**

- No wallet connection, no crypto settlement, no TON anything
- No percentage/custom splits (Phase 5)
- No file attachments
- No recurring expenses
- Equal splits only

**Success criteria:**

- A user can: create group → invite friends → add expenses → everyone sees balances → debts get marked as settled manually → group is clean
- Full cycle tested with 3+ real people
- Zero broken bot interactions
- UX feels on par with Splitwise basic functionality

---

## Phase 3: Crypto Settlement

**Goal:** Layer on-chain USDT settlement on top of the working Splitwise core. Testnet first, then mainnet.

**Deliverables:**

- Re-enable TON Connect wallet integration in settle flow (code exists from Phase 1, needs polish)
- Wallet management screen: connect, disconnect, see address, switch wallet
- Multiple wallet support per user (Tonkeeper, Telegram Wallet, MyTonWallet)
- "Pay with TON wallet" as primary option alongside "Mark as settled" on settle screen
- **Currency → USDT conversion at settlement:**
  - When user pays on-chain, convert the group-currency debt amount to USDT
  - Simple approach: fetch rate from a public API (e.g., CoinGecko, Binance) at settlement time
  - Show conversion clearly: "You owe €15.00 → ~15.82 USDT at current rate"
  - Rate is informational, fetched once at tx construction — no locking, no hedging
  - Store the conversion rate and USDT amount on the settlement record for audit
- Testnet USDT transfer construction + on-chain verification via TONAPI
- Clear testnet/mainnet indicator in UI
- Pre-flight balance check before settlement attempt
- Switch to mainnet USDT after testnet validation
- Payment state machine: `open → payment_pending → settled_onchain` with rollback
- Background reconciliation: "Refresh status" button for stuck `payment_pending`
- Clear error UX: insufficient balance, tx rejected, wallet disconnected mid-flow
- Rate limiting on settle endpoint

**Scope boundaries:**

- USDT only (no TON coin settlement yet)
- No partial payments
- No transaction fees
- One currency per group (multi-currency within a group is Phase 8)
- No rate guarantees — user sees rate at settlement time, small slippage accepted

**Success criteria:**

- First real USDT settlement processed and verified on-chain
- Zero false "settled" states
- Failure scenarios handled gracefully
- Currency conversion displayed clearly before user approves
- Non-crypto users unaffected (manual settlement still works)

---

## Phase 4: Retention & Trust

**Goal:** Make users come back. Build confidence that the app is reliable beyond one-time use.

**Deliverables:**

- Rich expense history and activity feed per group
- Group activity timeline (who added what, who settled when)
- Debt reminders — nudge debtors via bot with a friendly "you owe X to Y"
- Reminder scheduling (configurable frequency)
- Balance summary across all groups on home screen (improved)

**Scope boundaries:**

- No file attachments yet
- No analytics or dashboards
- No export

**Success criteria:**

- 30-day group retention measurable and improving
- Reminder → settlement conversion rate tracked

---

## Phase 5: Advanced Splitting

**Goal:** Handle real-world expense complexity beyond equal splits.

**Deliverables:**

- Unequal splits: exact amounts per person
- Percentage-based splits
- Custom ratios (e.g., 2:1:1)
- Expense categories (food, transport, accommodation, etc.)
- Attach photos/files to expenses and settlements (receipts, proof)

**Scope boundaries:**

- No recurring expenses yet
- No multi-currency
- Categories and advanced splits are free (premium = AI + multi-currency + analytics)

**Success criteria:**

- Covers the vast majority of real splitting scenarios
- Category data collected for future analytics

---

## Phase 6: Growth & Virality

**Goal:** Organic user acquisition through social mechanics and reduced friction.

**Deliverables:**

- Optimized invite flow: polish the link-based join experience
- Social proof in chats: "Alice settled $12.50 with Bob" visible to group
- Shareable expense summaries ("Trip to Bali — total $2,400 split among 4 people")
- Onboarding polish: first-time user experience, tooltip walkthrough
- Referral program (details TBD based on traction data)
- Option for group admin to send notifications to a TG group chat (not just individual DMs)

**Scope boundaries:**

- No paid acquisition
- No cross-promotion

**Success criteria:**

- Measurable viral coefficient
- Invite → active user conversion rate tracked and improving

---

## Phase 7: AI Features

**Goal:** Reduce friction in expense entry — the #1 chore in any expense tracker.

**Deliverables:**

- AI receipt scanning: snap a photo → extract merchant, amount, date, items
- Auto-suggest split based on receipt items
- Auto-categorization of expenses
- Quick-add: natural language entry ("dinner 45 split with alice and bob")

**Scope boundaries:**

- Accuracy doesn't need to be perfect — editable results are fine
- No accounting integrations

**Success criteria:**

- Photo → parsed expense in under 5 seconds
- Users prefer scanning over manual entry

---

## Phase 8: Multi-Currency Within Groups

**Goal:** Support mixed-currency expenses within a single group (Phase 2 gives each group one currency; this phase lets individual expenses use different currencies).

**Deliverables:**

- Per-expense currency override (e.g., group is USD but one expense is in EUR)
- Automatic conversion to group base currency for balance calculation
- Exchange rates updated via cron (background worker or scheduled fetch)
- Clear conversion display on mixed-currency expenses
- TON coin as additional settlement currency alongside USDT

**Scope boundaries:**

- No real-time rate locking — periodic updates, small slippage accepted
- No fiat settlement — on-chain only
- Basic per-group currency already handled since Phase 2

**Success criteria:**

- Mixed-currency expenses within a group work without confusion
- Rate discrepancy complaints minimal

---

## Phase 9: Monetization

**Goal:** Generate revenue after product-market fit.

**Deliverables:**

- Premium subscription (~$3-5/month) via Telegram Stars or USDT
- Gated features: AI scanning, multi-currency, analytics, unlimited group size, export
- Optional transaction fee (0.1-0.3%) if volume justifies it

**Scope boundaries:**

- Free tier stays fully functional (unlimited groups, up to 10 members, all split types, USDT settlement)
- No ads — ever

**Success criteria:**

- Premium conversion rate tracked
- Revenue per user metrics established

---

## Phase 10: Platform Expansion

**Goal:** Evolve from expense splitter into a full group finance tool.

**Deliverables:**

- Recurring expenses (rent, subscriptions) with auto-reminders
- Partial payments ("pay $10 of your $30 debt now")
- Analytics dashboard (spending by category, trends)
- CSV/PDF export
- Data export and account deletion (GDPR)

**Scope boundaries:**

- No budgeting or savings
- No external accounting integrations

**Success criteria:**

- Feature parity with Splitwise Pro + on-chain settlement as differentiator

---

## Phase Summary

| Phase | Name                | Key Milestone                          | Depends On |
| ----- | ------------------- | -------------------------------------- | ---------- |
| 1     | Core Prototype      | Basic expense splitting works          | —          |
| 2     | Splitwise Polish    | Daily-usable Splitwise clone           | Phase 1    |
| 3     | Crypto Settlement   | On-chain USDT settlement (mainnet)     | Phase 2    |
| 4     | Retention & Trust   | 30-day retention baseline              | Phase 2    |
| 5     | Advanced Splitting  | Real-world expense coverage            | Phase 2    |
| 6     | Growth & Virality   | Viral coefficient measured             | Phase 4    |
| 7     | AI Features         | Receipt scanning live                  | Phase 5    |
| 8     | Multi-Currency      | Mixed currencies within groups         | Phase 5    |
| 9     | Monetization        | Revenue stream active                  | Phase 7, 8 |
| 10    | Platform Expansion  | Full group finance tool                | Phase 9    |

Note: Phases 4 and 5 can run in parallel after Phase 2.

---

## Open Decisions (to resolve as we go)

- **Split types as free or premium** — All split types free. Premium = AI, multi-currency, analytics, export.
- **Referral program details** — design when Phase 6 is scoped
- **Transaction fee threshold** — introduce in Phase 9 only if volume justifies it
- **TON coin settlement** — Phase 8 alongside multi-currency
- **Premium pricing** — $3 vs $5/month, validate with users before Phase 9
- **Free tier group size** — 10 members may be too restrictive. Consider 20-25.
- **Data retention policy** — define before Phase 6 (growth brings diverse jurisdictions)
- **Notification strategy** — batch vs per-event vs configurable. Decide in Phase 2.
- **Settlement comments & attachments** — comments in Phase 2, attachments in Phase 5
- **Currency → USDT conversion source** — CoinGecko, Binance, or similar public API. Decide in Phase 3. Keep it to a single `fetch()` call, no SDK.
- **Currency list** — start with ~15 common currencies (USD, EUR, GBP, THB, VND, etc.). Expand later.
