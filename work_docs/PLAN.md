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

## Phase 3: UX Overhaul — DONE

**Goal:** Fix bugs, go stateless, restructure navigation, clean up the UI. Make the app feel like a real product.

**What was built:**

- **Stateless auth migration (Wave 1):**
  - Removed KV sessions entirely — auth is now stateless HMAC verification per request
  - Auth header format: `Authorization: tma <initData>` on every API call
  - `POST /api/v1/auth` simplified to upsert-only (register/update user, return profile)
  - Auth middleware validates initData, looks up user in D1 — no KV round-trip
  - `auth_date` max age increased to 86400s (TG doesn't refresh initData mid-session)
  - Deleted `session-manager.ts`, removed `SESSIONS: KVNamespace` from env and wrangler config
  - Frontend: removed all localStorage/sessionId logic, sends initData on every request
  - useAuth: retry once after 150ms if initData not available on first frame (fixes first-open bug)
  - Added `GET/PUT /api/v1/users/me` endpoint for Account page
- **Bug fixes (Wave 2):**
  - Removed unused deps: `@twa-dev/sdk`, `@tonconnect/ui-react`
  - Audited username handling — all render sites already guard for null
- **Component primitives (Wave 3):**
  - `PageLayout` — consistent padding wrapper for all pages
  - `LoadingScreen` — full-screen centered spinner (replaces 6 duplicated states)
  - `ErrorBanner` / `SuccessBanner` — dismissable status banners
  - `BottomSheet` — modal sliding up from bottom (extracted from Home.tsx)
  - `AppLayout` + `BottomTabs` — persistent shell with 3-tab bottom nav
  - `resolveCurrentUser()` hook — replaces duplicated TG user detection in 3 pages
  - Extracted `timeAgo()` to `utils/time.ts`, `shareInviteLink()` to `utils/share.ts`
- **Navigation & new pages (Wave 4):**
  - 3-tab bottom nav: Groups (`/`), Activity (`/activity`), Account (`/account`)
  - AppLayout wraps tabbed routes; inner pages (AddExpense, GroupSettings, SettleUp) render without tabs
  - Activity page: placeholder ("Activity feed coming soon")
  - Account page: editable display name via `PUT /api/v1/users/me`, read-only username
- **Screen improvements (Wave 5):**
  - Admin shown with crown icon (&#9812;) + "Admin" badge in member lists
  - "Expenses" tab renamed to "Transactions"
  - Amount input: `type="text" inputMode="decimal"` (no spinner buttons)
  - FABs repositioned to clear bottom tabs (`bottom-20`)
  - Create group navigates with `{ replace: true }` (fixes back-button)
  - All 5 pages refactored to use new components

**Deferred to later phases:**

- Telegram avatar display on Account page (Phase 6 — requires image handling)
- ~~Frontend framework/UI library~~ — **DECIDED: no library.** See `work_docs/research/3-frontend-framework.md`

---

## Phase 4: Transactions & Accounting Rework — DONE

**Goal:** Unify expenses and settlements into a coherent transaction view. Solve the balance integrity problem — prevent broken balances from post-settlement edits without being too restrictive.

**What was built:**

- **Balance integrity (Research):**
  - ~~RESEARCH: How Splitwise handles editing after settlement~~ — **CLOSED: non-problem by design.** Balances recompute from scratch on every request (expenses - settlements). Settlements are independent payment records; editing an expense naturally adjusts the balance. No special handling needed. See `work_docs/research/4-balance-integrity.md`.
  - ~~Q&A: Decide balance integrity rules~~ — **CLOSED: no rules needed.** The math is already correct.
- **Unified transaction list:**
  - Backend: `GET /api/v1/groups/:id/settlements` — lists completed settlements (settled_external + settled_onchain) with pagination and batch-resolved user names
  - Frontend: `mergeTransactions()` utility merges expenses + settlements sorted by createdAt DESC
  - `TransactionItem` discriminated union type for type-safe rendering
  - Settlement cards: green-tinted background, checkmark icon, "You paid X" / "X paid you" personalization, optional comment display
  - Group page Transactions tab now shows both expenses and settlements in a unified timeline
- **Full currency list with search:**
  - Expanded from 15 to 150+ active ISO 4217 currencies (both backend + frontend)
  - `PINNED_CURRENCIES` (USD first), `CURRENCY_LIST` (pinned + rest sorted alphabetically), `searchCurrencies(query)` (filters by code, name, symbol, case-insensitive)
  - `CurrencyPicker` component: searchable BottomSheet with blue highlight + checkmark on selected item
  - `CurrencyButton` component: displays current currency with down-arrow indicator
  - Replaced `<select>` dropdowns in Home.tsx (create group) and GroupSettings.tsx (edit currency)
  - `BottomSheet` enhanced: `max-h-[85vh]` overflow protection, `zIndex` prop for stacking
- **Tests:**
  - 13 new currency tests (CURRENCY_LIST ordering, searchCurrencies edge cases, 3-decimal currencies, 100+ count)
  - 6 new transaction merge tests (empty, expenses-only, settlements-only, interleaving, same-timestamp stability)
  - Total: 50 tests passing (6 backend + 44 frontend)

---

## Phase 5: Themes & Internationalization — DONE

**Goal:** Native dark/light theming via Telegram's CSS variables and multi-language UI.

**What was built:**

- **Theme system:**
  - Mapped all 15 Telegram `--tg-theme-*` CSS variables to Tailwind `tg-*` color tokens in `tailwind.config.js`
  - Added fallback CSS custom properties in `index.css` for dev/browser (light mode defaults)
  - Replaced all hardcoded colors (`bg-white`, `text-gray-500`, `bg-blue-500`, etc.) with `tg-*` tokens across all components
  - Removed all `dark:` prefixes — CSS vars handle both modes automatically
  - Removed manual `dark` class toggling and `document.body.style` from App.tsx
  - Semantic colors (positive/negative/warning) via `--app-*` CSS custom properties with light/dark variants, mapped to Tailwind `app-*` tokens. `data-theme` set from `webApp.colorScheme`.
- **i18n (react-i18next):**
  - Installed `react-i18next` + `i18next`
  - Created `i18n.ts` config with inline JSON imports, fallback to English, dev missing key warnings
  - 11 locale files: en, ru, es, hi, id, fa, pt, uk, de, it, vi (~100 keys each)
  - Replaced all hardcoded English strings with `t()` calls across all pages and components
  - CLDR plurals for Russian and Ukrainian (one/few/many), Indonesian and Vietnamese (other only)
  - `timeAgo()` utility uses i18n for time strings
- **Language persistence (CloudStorage):**
  - On init: try CloudStorage → detect from TG user `language_code` → fallback English
  - On change: save to CloudStorage (fire-and-forget)
  - Added `CloudStorage` to Telegram WebApp type declarations
- **Language selector on Account page:**
  - Tappable button showing flag + native language name, opens BottomSheet with all 11 languages
  - Checkmark on current selection, follows CurrencyPicker pattern
  - Switching language updates all visible text immediately
- **Phase 4 bug fixes (bundled):**
  - A1: Balance colors in Group page — red if user owes, green if owed to user, neutral otherwise
  - A2: Home screen per-currency balance breakdown — groups balances by currency, shows one row per currency
  - A3: Transaction/settlement amount colors — green if you paid/received, red if you owe, neutral for uninvolved
  - A4: Currency shown in Amount field label (e.g., "Amount (USD)")
  - A5: Fixed MainButton jumping — split into separate effects for show/hide, text, enabled/progress, click handler
  - A6: Settings → "Info" label for non-admin
  - A7: Removed "Admin" text from member badges — crown only
  - A8: Admin kick member — backend `DELETE /groups/:id/members/:userId` + frontend kick button (X) in GroupSettings
  - A9: Input validation maxLength on group name (100), expense description (500), settlement comment (500)
- **Frontend deps added:** `react-i18next@16.5.4`, `i18next@25.8.13`

**Tests:** All 50 tests passing (6 backend + 44 frontend)

---

## Phase 6: Images & Storage — DONE

**Goal:** User/group avatars and expense receipt attachments via Cloudflare R2.

**What was built:**

- **R2 infrastructure:**
  - R2 bucket `splitogram-images` with `IMAGES` binding in `wrangler.toml`
  - Worker-served images via `GET /r2/*` route with `Cache-Control: public, max-age=31536000, immutable`
  - Vite dev proxy for `/r2` pointing to wrangler
  - `backend/src/utils/r2.ts` — shared R2 utilities (key generation, safe delete, upload validation)
- **Client-side image processing (`frontend/src/utils/image.ts`):**
  - `processImage()` pipeline: load → resize → strip EXIF → JPEG blob via Canvas API
  - `processAvatar()` (256px, 0.80 quality), `processReceipt()` (1200px, 0.85), `processReceiptThumbnail()` (200px, 0.75)
  - `validateImageFile()` — type + size validation (20MB input limit, JPEG/PNG/WebP)
  - Zero new dependencies — all native Canvas API
- **DB migration 0004:**
  - `users.avatar_key`, `groups.avatar_key`, `groups.avatar_emoji`
  - `expenses.receipt_key`, `expenses.receipt_thumb_key`
- **User avatars:**
  - Upload: `POST /api/v1/users/me/avatar` (multipart FormData, 5MB server limit)
  - Delete: `DELETE /api/v1/users/me/avatar`
  - Old avatar auto-deleted from R2 on re-upload
  - `Avatar` component with initials fallback, used on Account page + member lists (Group, GroupSettings)
- **Group avatars:**
  - Emoji picker (20 preset emojis) on GroupSettings page
  - Custom image upload: `POST /api/v1/groups/:id/avatar` (admin only)
  - Delete: `DELETE /api/v1/groups/:id/avatar`
  - Custom image clears emoji, emoji clears image
  - Displayed on Home page group list + Group page header
- **Expense receipt attachments:**
  - Optional image on AddExpense page with preview
  - Upload: `POST /api/v1/groups/:id/expenses/:expenseId/receipt` (original + thumbnail)
  - Delete: `DELETE /api/v1/groups/:id/expenses/:expenseId/receipt`
  - Client-side thumbnail generation (200px)
  - Thumbnail displayed in transaction list, full image on tap in BottomSheet
- **R2 cleanup on delete:**
  - Expense deleted → receipt + thumbnail deleted from R2
  - Group deleted → group avatar + all expense receipts batch deleted
  - Avatar re-uploaded → old avatar deleted
  - All cleanup is best-effort via `waitUntil()`, never blocks DB operations
- **i18n:** All new UI strings translated to all 11 languages

**DB migrations:** 0004 (avatar_key, avatar_emoji, receipt_key, receipt_thumb_key)

**Tests:** All 50 tests passing (6 backend + 44 frontend). Zero new dependencies.

---

## Phase 7: Retention & Engagement + UI Fixes — DONE

**Goal:** Keep users coming back. Fill the Activity tab, add reminders, rework balances view. Combined with UI fixes: SVG icons, permission tightening, currency lock, copy-to-clipboard, receipt display in edit mode.

**What was built:**

- **SVG icons + UI quick fixes (Wave 1):**
  - 6 SVG icon components in `frontend/src/icons/` (IconUsers, IconActivity, IconUser, IconCopy, IconCrown, IconCheck)
  - UserContext for avatar/name state sharing across BottomTabs + Account
  - BottomTabs: SVG icons replace letter placeholders, Account tab shows user avatar when available
  - Settings button: blue for admin, gray for non-admin
  - Removed member chips from group header (moved to Balances tab)
  - Copy invite link button with clipboard API
  - Replaced all Unicode symbols (crown, checkmark) with SVG icons
- **Expense permissions + currency lock (Wave 2):**
  - Creator-only expense edit (admin can still delete)
  - Existing receipt shown during edit mode with remove/replace support
  - Currency locked after first expense in a group (backend 400 + frontend disabled picker)
  - `hasTransactions` boolean added to group detail API
- **Balances tab rework (Wave 3):**
  - All group members shown with net balances (sorted by |amount|), with Avatar component
  - Settled members shown with "Settled up" label
  - Debt cards with settle-up buttons below member list
- **Activity log + feed (Wave 4):**
  - `activity_log` DB table with indexes on groupId, createdAt
  - `logActivity()` service — inline D1 writes on all mutations
  - Instrumented: expense create/edit/delete, settlement complete, member join/leave/kick
  - `GET /api/v1/activity` — cross-group feed with cursor-based pagination
  - `GET /api/v1/groups/:id/activity` — per-group feed
  - Full Activity page with avatar, localized text, group badge, timeAgo
  - Per-group Activity tab (third tab in group view)
- **Debt reminders (Wave 5):**
  - `debt_reminders` DB table with unique index + 24h cooldown
  - `POST /groups/:id/reminders` with debt graph verification via `simplifyDebts`
  - Bot DM notification with "View Group" button
  - Frontend: "Send Reminder" button for creditors with cooldown error handling
- **Tests:** 17 new tests (9 activity text, 8 permissions). Total: 67 (6 backend + 61 frontend)
- **i18n:** All new keys translated to all 11 locales

**DB migrations:** 0005 (activity_log + debt_reminders tables)

**Scope note:** Cross-group balance summary with exchange rates deferred — showing per-currency balances instead (no conversion needed).

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

| Phase | Name                      | Key Milestone                         | Depends On  |
| ----- | ------------------------- | ------------------------------------- | ----------- |
| 1     | Core Prototype            | Basic expense splitting works         | —           |
| 2     | Splitwise Polish          | Daily-usable Splitwise clone          | Phase 1     |
| 3     | UX Overhaul               | Stateless auth + 3-tab nav + cleanup  | Phase 2     |
| 4     | Transactions & Accounting | Unified timeline + full currency list | Phase 3     |
| 5     | Themes & i18n             | Dark/light + 11 languages             | Phase 3     |
| 6     | Images & Storage          | Avatars + attachments via R2          | Phase 3     |
| 7     | Retention & Engagement    | Activity feed + reminders             | Phase 4     |
| 8     | Advanced Splitting        | Equal / % / manual split modes        | Phase 4     |
| 9     | Growth & Virality         | _Speculative — evaluate later_        | Phase 7     |
| 10    | Crypto Settlement         | On-chain USDT (mainnet)               | Phase 4     |
| 11    | AI & Monetization         | _Speculative — evaluate later_        | Phase 8, 10 |

Phases 4, 5, and 6 can run in parallel after Phase 3. Phase 10 has no dependency on Phases 5–9.

---

## Open Decisions (to resolve via Q&A steps)

- ~~**Balance integrity after settlement**~~ — **CLOSED: non-problem.** Balances recompute from scratch; no special handling needed. See `work_docs/research/4-balance-integrity.md`.
- ~~**Frontend framework/UI library**~~ — DECIDED Phase 3: no library, stay with React + Tailwind
- ~~**i18n approach**~~ — **DECIDED: react-i18next.** See `work_docs/research/5-i18n-approach.md`.
- ~~**User preference persistence**~~ — **DECIDED: CloudStorage for language, no persistence for theme (follows Telegram).** localStorage unreliable in TG WebView. See `work_docs/research/done/5-themes-and-persistence.md`.
- ~~**R2 access pattern**~~ — **DECIDED: Worker-served, no public bucket.** Content-addressed keys with immutable caching. See `work_docs/research/6-image-storage-r2.md`.
- **Exchange rate source for cross-group balances** — Free API for USD conversion. Decide in Phase 7 (before Phase 10's crypto rate discussion).
- **Premium pricing** — $3 vs $5/month. Evaluate if Phase 11 ever becomes concrete.
- **Free tier group size** — Currently uncapped. Consider limits if growth demands it.
- **Currency → USDT conversion source** — CoinGecko, Binance, etc. Decide in Phase 10 Q&A.
- **Data retention policy** — Define before any growth push.
