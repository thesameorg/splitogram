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

## Phase 2: Splitwise Polish — DONE

**Goal:** Make the expense splitting experience solid and complete — the app people actually want to use daily. No crypto, just a great Splitwise clone inside Telegram.

**What was built:**

- **Bug fixes (Wave 1):**
  - Fixed `PAGES_URL` deployment (wrangler `--var` separator)
  - Fixed creditor "Mark as Settled" being disabled
  - Fixed webhook join for 101+ members
  - Fixed `language_code` validation rejecting valid users
  - Removed crypto references from bot messages
- **Tech debt cleanup (Wave 2):**
  - Fixed N+1 query on home screen (single query with joins)
  - Unified balance computation into one `computeGroupBalances` function
  - Typed Drizzle DB throughout (no more `db: any`)
  - Shared `formatAmount` / `getCurrency` utilities (backend + frontend)
  - Singleton Bot API instance per notification batch
  - Pagination offset clamping, dead code removal
- **Manual settlement rework (Wave 3):**
  - Either party (debtor OR creditor) can mark a debt as settled
  - Settlement with optional comment (e.g., "paid via bank transfer")
  - Removed all crypto/wallet UI — clean manual flow
- **Expense management (Wave 3):**
  - Edit expense (amount, description, participants) — `PUT /api/v1/groups/:id/expenses/:expenseId`
  - Delete expense — `DELETE /api/v1/groups/:id/expenses/:expenseId`
- **Per-group currency (Wave 3):**
  - 15 currencies (USD, EUR, GBP, THB, VND, JPY, IDR, etc.) with correct symbols and decimals
  - Currency selectable at group creation and in settings
  - All amounts display with correct currency formatting (including zero-decimal currencies)
- **Group management (Wave 4):**
  - Group settings page (rename, currency, invite regeneration)
  - Delete group (admin only, cascade delete, force-delete for outstanding balances)
  - Leave group (non-admin, zero-balance check)
  - Owner indicator in member list
- **UX fixes (Wave 4):**
  - Personalized "You owe" / "Owes you" labels using current user ID
  - Hidden in-page submit button when inside Telegram (TG MainButton only)
  - Smart `join_` deep link: auto-resolve invite → join → navigate to group
  - Bot join buttons deep-link directly to group page
- **Notification improvements (Wave 4):**
  - Per-group mute toggle (muted members skip notifications)
  - Bot 403 handling: catch blocked users, track `botStarted` flag, skip non-started users
  - `GrammyError` catch with `onBotBlocked` callback pattern
- **Frontend tests (Wave 5):**
  - 19 tests for `formatAmount` / `formatSignedAmount` (multi-currency, zero-decimal, signed)
  - 7 tests for currency utilities (`CURRENCIES`, `CURRENCY_CODES`, `getCurrency`)
  - Total: 32 tests passing (6 backend + 26 frontend)

**DB migrations:** 0001 (settlement comment/settledBy), 0002 (group currency), 0003 (botStarted, muted)

All Phase 2 specs completed and archived.

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
