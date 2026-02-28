# Splitogram — Business Phases

Phased roadmap from prototype to full product. Each phase has a clear goal, deliverables, and success criteria.

**Core insight:** Features first, crypto later. Ship a daily-usable expense splitter with real polish — themes, languages, images, proper accounting. Crypto settlement is the differentiator but only matters after the core product is solid.

Steps marked **RESEARCH** require investigation before implementation. Steps marked **Q&A** require a decision session before proceeding.

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
- TON Connect wallet integration + on-chain settlement (basic, testnet) — **functional but deferred for polish**

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

## Phase 3: UX Overhaul — NEXT

**Goal:** Fix bugs, go stateless, restructure navigation, clean up the UI. Make the app feel like a real product.

**Steps:**

1. **Bugfix: Login-with-Telegram first-open failure** — Auth fails on first app open, works on second (per user). This is a production bug hitting every new user. Investigate and fix first.
2. **Bugfix: Users without @username or profile image** — Verify all flows (auth, display, group members, notifications) handle missing username and missing avatar gracefully.
3. **Architecture: Remove KV sessions, go stateless** — Telegram's `initData` is HMAC-signed and can be verified on every request server-side with zero external calls. KV sessions add latency, complexity, and a failure mode for no benefit. Remove the KV session layer. Auth becomes stateless HMAC verification per request. Remove KV binding from `env.ts`, simplify auth middleware.
4. **RESEARCH: Frontend framework/UI library decision** — Current stack is plain React + Tailwind. Evaluate whether to adopt a component library or framework (e.g., Telegram UI kit, shadcn/ui, or similar) given upcoming needs: themes, i18n, bottom nav, form components. Decide before building new UI.
5. **Technical: Component architecture cleanup** — Audit frontend components. Split large files into focused single-responsibility `.tsx` files. Each UI element identifiable and editable in one place.
6. **Bottom sticky navigation — three tabs:** Groups (current home), Activity (empty state initially — "coming soon" or blank), Account.
7. **Groups screen improvements:**
   - Admin shown with crown icon
   - Copy-invite-link button visible to any group member (not just admin)
8. **Account page:**
   - Edit display name
   - Telegram avatar displayed (from `initData` `photo_url` — no storage needed)
   - Telegram username shown (read-only)
9. **UX cleanups (moved from Phase 4):**
   - Rename "Expenses" section to "Transactions" throughout the app
   - Remove up/down spinner buttons on amount input field
   - Fix back-button navigation after creating or editing transactions

**Success criteria:**
- Login bug fixed and verified
- Auth is stateless — KV sessions removed
- App has 3-tab navigation (Groups, Activity, Account)
- Account page shows real Telegram avatar and editable name
- Frontend components cleanly separated
- No navigation bugs after create/edit flows

---

## Phase 4: Transactions & Accounting Rework

**Goal:** Unify expenses and settlements into a coherent transaction view. Solve the balance integrity problem — prevent broken balances from post-settlement edits without being too restrictive.

**Steps:**

1. **RESEARCH: How Splitwise handles editing after settlement** — What happens when someone edits an expense that was already settled? Does it reopen the settlement? Block edits? Show a warning? Document findings.
2. **Q&A: Decide balance integrity rules** — Based on research, choose approach. Candidates: (a) warn + auto-reopen affected settlements, (b) block edits on expenses involved in settlements, (c) allow edits but show "balances changed since last settlement" indicator. Pick one.
3. **Unified transaction list** — Settlements visible alongside expenses with visually distinct layout (different card style, icon, color).
4. **Implement balance integrity rules** (from Q&A in step 2).
5. **Currencies: full list with search** — Load a comprehensive currency list (online source → saved as JSON). Add search bar to currency selector (search by name, code, symbol). USD pinned at top.

**Success criteria:**
- Transaction list shows both expenses and settlements, visually distinct
- Editing a settled expense follows the chosen integrity rule without breaking balances
- Currency selector has full searchable list

---

## Phase 5: Themes & Internationalization

**Goal:** Support dark/light/system themes and multiple UI languages.

**Steps:**

1. **RESEARCH: Telegram Mini App theme API + persistence** — How to detect system theme (dark/light) from Telegram. What CSS variables TG provides. How other Mini Apps handle theming. Critically: how reliable is localStorage in TG WebView across iOS/Android? This determines the save strategy for both themes and language.
2. **RESEARCH: i18n approach** — Lightweight custom JSON lookup vs `react-i18next` or similar lib. Decide based on bundle size, complexity, and plural/interpolation needs.
3. **Q&A: Decide persistence strategy for user preferences** — Based on research: localStorage only, localStorage + D1 `users` table, or cookies. Pick one approach for both theme and language.
4. **Theme system** — Three options: dark, light, system (default). System reads from Telegram's current theme.
5. **Two color palettes** — Light and dark. Apply via CSS variables or Tailwind dark mode.
6. **i18n framework** — JSON-based translation files, one per language. Simple key-value with namespace support.
7. **Missing translation fallback** — In development: show the raw key (e.g., `ACCOUNT_DESCRIPTION_TEXT`) to catch untranslated strings. In production: fall back to English.
8. **Languages: English (base), Russian, Spanish.**
9. **Save theme and language preferences** using the approach decided in step 3. Default theme: system. Default language: detect from Telegram's `language_code`.
10. **Wire up Account page** — Theme selector and language selector now functional.

**Success criteria:**
- Theme switches instantly, persists across sessions
- System theme follows Telegram's dark/light mode
- All UI text comes from translation files
- Switching language changes all visible text
- Dev mode shows raw keys for missing translations; production falls back to English

---

## Phase 6: Images & Storage

**Goal:** User/group avatars and transaction document attachments via Cloudflare R2.

**Prerequisites:** Set up R2 bucket(s) before any code — separate logical spaces for avatars and transaction documents.

**Steps:**

1. **RESEARCH: Cloudflare R2 with Workers** — Access patterns (signed URLs vs public), client-side image conversion (HEIC → JPG for iPhone), thumbnail generation strategy (Workers vs client-side).
2. **User avatars** — Allow custom upload from Account page (on top of existing Telegram avatar from Phase 3).
3. **Group avatars** — Emoji picker for quick group icons + optional custom image upload.
4. **Transaction image attachments** — Attach images to expenses and settlements (receipts, proof). JPG, PNG, SVG only.
5. **Client-side processing** — Convert non-standard formats (HEIC, etc.) to JPG/PNG on device. Strip EXIF metadata. Rename to neutral ID.
6. **Thumbnail generation** — 96px square thumbnails for list views. Avoid loading full-size images in feeds.
7. **Cleanup on delete** — When image is removed (or parent entity deleted), delete from R2. No orphaned files.

**Success criteria:**
- User and group avatars display throughout the app
- Transaction images upload and display correctly
- iPhone photos (HEIC) handled transparently
- No orphaned files in R2 after deletion
- Thumbnails load fast in list views

---

## Phase 7: Retention & Engagement

**Goal:** Keep users coming back. Fill the Activity tab, add reminders, improve the home screen.

**Steps:**

1. **Activity feed (cross-group)** — Populate the Activity tab from Phase 3. Shows all activity across all groups where the user is a member: expenses added/edited/deleted, settlements, members joined/left. Chronological, with pagination (pull-to-load-more).
2. **Per-group activity** — Same feed filtered to a single group, accessible from within the group screen.
3. **Debt reminders** — "Send reminder" button visible to creditors next to each debt. Sends bot DM to debtor. Cooldown (e.g., 1 per 24h per debt) to prevent spam.
4. **Cross-group balance summary on home screen** — Show net balance across all groups. For users in groups with different currencies, convert to USD equivalent for the total. Use a simple free exchange rate API (single `fetch()` call, cached).

**Scope boundaries:**
- No scheduled/automatic reminders — always manually triggered by creditor
- No analytics or dashboards
- No export

**Success criteria:**
- Activity tab shows meaningful cross-group feed with pagination
- Creditors can nudge debtors via the app
- Home screen shows a useful "you owe / you're owed" total in USD

---

## Phase 8: Advanced Splitting

**Goal:** Handle real-world expense complexity beyond equal splits.

**Steps:**

1. **Split mode selector in expense creation flow** — Enter total amount first, then select split mode, then allocate, then save. One unified flow, three modes:
   - **Equal** (default) — divide evenly among selected participants
   - **Percentage** — assign % per person, must total 100%
   - **Manual** — assign exact amounts per person, must total the entered amount (zero remainder validation)
2. **Update edit expense flow** to support changing split mode on existing expenses.

**Scope boundaries:**
- No custom ratios (covered by manual mode)
- No recurring expenses
- No expense categories

**Success criteria:**
- All three split modes work in create and edit flows
- Zero-remainder validation prevents mismatched amounts
- Covers the vast majority of real splitting scenarios

---

## Phase 9: Growth & Virality — SPECULATIVE

> **Status: not sure at all.** Evaluate based on traction and user feedback. May be reprioritized, reduced, or dropped entirely.

**Ideas (not commitments):**

- Optimized invite flow — polish link-based join UX
- Social proof in chats: "Alice settled $12.50 with Bob" visible to group
- Shareable expense summaries ("Trip to Bali — $2,400 split among 4")
- Onboarding polish — first-time user experience, tooltip walkthrough
- Option for group admin to push notifications to a TG group chat (not just DMs)
- Referral program (design TBD)

---

## Phase 10: Crypto Settlement

**Goal:** Layer on-chain USDT settlement on top of the polished product. Testnet first, then mainnet.

**Steps:**

1. **RESEARCH: TON Connect current state** — Review TON Connect SDK, wallet compatibility (Tonkeeper, Telegram Wallet, MyTonWallet), USDT jetton on TON, TONAPI for verification. Check what changed since Phase 1 code was written.
2. **Q&A: Conversion source & UX** — Decide rate API (CoinGecko, Binance, etc.). Decide conversion display UX ("€15.00 → ~15.82 USDT"). Single `fetch()` call, no SDK.
3. Re-enable TON Connect wallet integration (Phase 1 code exists, needs refresh)
4. Wallet management: connect, disconnect, see address
5. "Pay with TON wallet" alongside "Mark as settled" on settle screen
6. Currency → USDT conversion at settlement time (informational rate, no locking)
7. Testnet USDT transfer + on-chain verification via TONAPI
8. Payment state machine: `open → payment_pending → settled_onchain` with rollback
9. "Refresh status" button for stuck `payment_pending` states
10. Error UX: insufficient balance, tx rejected, wallet disconnected
11. Switch to mainnet after testnet validation

**Scope boundaries:**
- USDT only (no TON coin yet)
- No partial payments
- No transaction fees
- No rate guarantees — small slippage accepted

**Success criteria:**
- First real USDT settlement on-chain
- Zero false "settled" states
- Non-crypto users unaffected (manual settlement still works)

---

## Phase 11: AI & Monetization — SPECULATIVE

> **Status: not sure at all.** These are long-term ideas. Evaluate after the core product has real users and traction data. May be reprioritized, reduced, or dropped entirely.

**Ideas (not commitments):**

- AI receipt scanning — photo → extract merchant, amount, date, items
- Auto-suggest split based on receipt items
- Natural language expense entry ("dinner 45 split with alice and bob")
- Multi-currency within groups — per-expense currency override, auto-conversion to group base currency
- Premium subscription (~$3-5/month via Telegram Stars or USDT). Gated: AI scanning, multi-currency, analytics, export.
- Partial payments ("pay $10 of your $30 debt")
- Analytics dashboard (spending by category, trends)
- CSV/PDF export
- Data export & account deletion (GDPR)
- TON coin as additional settlement currency alongside USDT

---

## Phase Summary

| Phase | Name                        | Key Milestone                        | Depends On  |
| ----- | --------------------------- | ------------------------------------ | ----------- |
| 1     | Core Prototype              | Basic expense splitting works        | —           |
| 2     | Splitwise Polish            | Daily-usable Splitwise clone         | Phase 1     |
| 3     | UX Overhaul                 | Stateless auth + 3-tab nav + cleanup | Phase 2     |
| 4     | Transactions & Accounting   | Unified transaction view + integrity | Phase 3     |
| 5     | Themes & i18n               | Dark/light + 3 languages             | Phase 3     |
| 6     | Images & Storage            | Avatars + attachments via R2         | Phase 3     |
| 7     | Retention & Engagement      | Activity feed + reminders            | Phase 4     |
| 8     | Advanced Splitting          | Equal / % / manual split modes       | Phase 4     |
| 9     | Growth & Virality           | *Speculative — evaluate later*       | Phase 7     |
| 10    | Crypto Settlement           | On-chain USDT (mainnet)              | Phase 4     |
| 11    | AI & Monetization           | *Speculative — evaluate later*       | Phase 8, 10 |

Phases 4, 5, and 6 can run in parallel after Phase 3. Phase 10 has no dependency on Phases 5–9.

---

## Open Decisions (to resolve via Q&A steps)

- **Balance integrity after settlement** — Decide in Phase 4 Q&A (after Splitwise research)
- **Frontend framework/UI library** — Decide in Phase 3 research (before building new UI)
- **i18n approach** — Custom JSON vs `react-i18next`. Decide in Phase 5 research.
- **User preference persistence** — localStorage vs localStorage+DB vs cookies for theme/language. Decide in Phase 5 Q&A after researching TG WebView behavior.
- **R2 access pattern** — Public URLs vs signed URLs for images. Decide in Phase 6 research.
- **Exchange rate source for cross-group balances** — Free API for USD conversion. Decide in Phase 7 (before Phase 10's crypto rate discussion).
- **Premium pricing** — $3 vs $5/month. Evaluate if Phase 11 ever becomes concrete.
- **Free tier group size** — Currently uncapped. Consider limits if growth demands it.
- **Currency → USDT conversion source** — CoinGecko, Binance, etc. Decide in Phase 10 Q&A.
- **Data retention policy** — Define before any growth push.
