# Architecture & Tech Decisions

Living document. Updated as architectural decisions are made.

---

## Stack

| Layer            | Choice                          | Why                                                   |
| ---------------- | ------------------------------- | ----------------------------------------------------- |
| Runtime          | Bun                             | Fast, native TS, workspace support                    |
| Backend          | Hono (CF Worker)                | Built for Workers, 14KB, runs on Bun/Node/Workers     |
| Bot              | grammY                          | TS-first, modern, plugin ecosystem                    |
| ORM              | Drizzle                         | Typed, lightweight, D1 adapter                        |
| Validation       | Zod + `@hono/zod-validator`     | Integrated with Hono                                  |
| Frontend         | React 19 + Vite + Tailwind      | Mature ecosystem, small reusable component primitives |
| i18n             | react-i18next                   | CLDR plurals (Russian 3-form), interpolation, 15KB gz |
| TON verification | TONAPI REST API (plain `fetch`) | No SDK needed on backend                              |
| Smart contract   | Tact (Blueprint + Sandbox)      | High-level TON lang, typed, testable                  |

**Admin dashboard:** Plain HTML at `/admin`, same Worker, `hono/basic-auth` with `ADMIN_SECRET`. External browser only (no TG `initData` available outside WebView). Frontend admin link uses Worker URL (`config.apiBaseUrl`) as base, not Pages origin — since Pages and Worker are separate deployments. Vite proxy includes `/admin` for local dev. Bot `/stats` command for quick metrics.

**Frontend framework/UI library:** Plain React + Tailwind, no component library. Decided Phase 3 — see below.

---

## Deployment

```
Cloudflare Pages          Cloudflare Worker              Cloudflare D1 (SQLite)
(frontend static)    →    (API + bot webhook)      →     Cloudflare R2 (images)
React + Vite               Hono + grammY + Drizzle        TONAPI (external REST)

TON Blockchain
SplitogramSettlement contract (Tact)  →  receives USDT → splits commission → forwards remainder
```

**Why Cloudflare over GCloud:** $0 at MVP (free D1, R2, Pages), ~0ms cold starts (V8 isolates), `wrangler dev` for fast local dev. Escape hatch: same Hono code runs on a $5 VPS with Bun + Docker.

**D1 caveat:** SQLite, not Postgres. Drizzle supports both. No cross-DB joins or stored procedures — fine for our use case.

---

## Authentication: Stateless HMAC (implemented Phase 3)

**Decision:** Remove KV sessions. Auth is stateless HMAC verification per request.

**How it works:** Telegram's `initData` is HMAC-SHA256 signed by the bot token. The backend verifies the signature on every API request — zero external calls, no KV, no session state.

**Auth header format:** `Authorization: tma <initData>` — frontend sends this on every request. Backend validates signature, looks up user in D1, sets session context.

**Login flow:** Frontend calls `POST /api/v1/auth` once on mount (upserts user into D1, returns profile + resolved `locale`). All subsequent API calls carry initData in headers — middleware validates inline.

**First-open fix:** Frontend retries auth once after 150ms delay if initData is not available on first frame (TG WebApp SDK race condition).

**`auth_date` max age:** 86400s (24h). Generous window since TG doesn't refresh initData mid-session and we verify on every request.

**Why:** KV sessions added latency (network round-trip on every request), a failure mode (KV down = everyone logged out), and complexity — all for zero benefit. Telegram Mini Apps don't have "logout." The signed `initData` is the session.

**What was removed:** KV binding from `env.ts`, `session-manager.ts`, KV namespace from wrangler config. Frontend removed all localStorage/sessionId logic.

**Previous approach (Phases 1-2):** `POST /api/v1/auth` validated initData, created a KV session (1h TTL), returned a session ID. All requests sent `Authorization: Bearer {sessionId}`. Auth middleware hit KV on every request to validate.

---

## Frontend: No Component Library (decided Phase 3)

**Decision:** Stay with plain React 19 + Tailwind CSS. No component library (no shadcn/ui, no @telegram-apps/telegram-ui).

**Why:** Evaluated both candidates — `@telegram-apps/telegram-ui` is unmaintained (last release Oct 2024, no React 19 support, grant-funded with no active development) and shadcn/ui adds Radix UI dependency weight, has no bottom nav component, and has known iOS WebView issues with Select. Our components are simple lists, cards, and forms — a library adds migration cost and dependency risk without meaningful benefit.

**Approach:** Build a small set of reusable primitives (`<BottomTabs>`, `<BottomSheet>`, `<PageLayout>`, CSS variable theme tokens) instead. Re-evaluate if a mature, React 19-compatible Telegram UI library emerges.

See `work_docs/research/3-frontend-framework.md` for full analysis.

---

## Navigation: 3-Tab Bottom Nav (implemented Phase 3)

**Tabs:** Groups | Feed | Account

- **Groups** (`/`) — home screen, list of user's groups with balances
- **Feed** (`/activity`) — cross-group activity feed with cursor-based pagination. Shows expense/settlement/member events across all groups with per-group currency formatting.
- **Account** (`/account`) — editable display name + avatar via `PUT /api/v1/users/me`, read-only Telegram username. Language selector, feedback form, ToS/Privacy links.

**Layout:** `AppLayout` wraps tabbed routes (`/`, `/activity`, `/account`, `/groups/:id`) with `BottomTabs`. Inner pages (AddExpense, GroupSettings, SettleUp) render without tabs — full-screen.

## Component Primitives (implemented Phase 3)

Small reusable components extracted from pages:

- **`PageLayout`** — consistent `p-4 pb-24` wrapper
- **`LoadingScreen`** — full-screen centered spinner
- **`ErrorBanner` / `SuccessBanner`** — dismissable status banners
- **`BottomSheet`** — modal sliding up from bottom
- **`AppLayout` + `BottomTabs`** — persistent shell with 3-tab bottom nav
- **`resolveCurrentUser()`** — determines current user from group members (TG user ID → member lookup, dev fallback to first admin)
- **`shareInviteLink()`** — shared utility for invite sharing (TG share dialog or clipboard)
- **`timeAgo()`** — relative time formatting

---

## Data Model

- **users**: telegram_id, username, display_name, wallet_address, bot_started, avatar_key, is_dummy
- **groups**: name, invite_code, is_pair, currency (default 'USD'), created_by, avatar_key, avatar_emoji
- **group_members**: group_id, user_id, role (admin/member), muted
- **expenses**: group_id, paid_by, amount (micro-units integer), description, split_mode, receipt_key, receipt_thumb_key
- **expense_participants**: expense_id, user_id, share_amount
- **settlements**: group_id, from_user, to_user, amount, status (open/payment_pending/settled_onchain/settled_external), tx_hash, comment, settled_by, receipt_key, receipt_thumb_key
- **activity_log**: group_id, actor_id, type (group_created/expense_created/edited/deleted, settlement_completed, member_joined/left/kicked), target_user_id, expense_id, settlement_id, amount, metadata (JSON), created_at
- **debt_reminders**: group_id, from_user_id (creditor), to_user_id (debtor), last_sent_at (24h cooldown)
- **exchange_rates**: id (singleton row), base ('USD'), rates (JSON), fetched_at (unix timestamp, 24h TTL)

Amounts stored as integers in micro-units (1 unit = 1,000,000). Currency is per-group. No floating point. Settlements store `usdtAmount` and `commission` (micro-units) for on-chain settlements.

---

## Debt Simplification

No library. ~30-line greedy algorithm in `services/debt-solver.ts`:

1. Compute net balance per person (one SQL query)
2. Separate into creditors (positive) and debtors (negative)
3. Greedy match: pair largest creditor with largest debtor, transfer `min(credit, |debt|)`, repeat

Good enough for groups under 50 people. Tested with 6 cases.

---

## Currency Support (Phase 2 + Phase 4)

150+ currencies with correct symbols and decimal handling. Full searchable currency list via `CurrencyPicker` component. Shared `utils/currencies.ts` + `utils/format.ts` in both backend and frontend (identical files). Amounts stored as micro-units (1 unit = 1,000,000) regardless of currency. Zero-decimal currencies (VND, JPY, IDR) display without decimals but use the same micro-unit storage. Currency is locked per-group once expenses exist.

---

## Expense Splitting (Phase 8)

Single expense creation flow with mode switcher:

1. Enter total amount
2. Select split mode: **Equal** (default) | **Percentage** | **Manual**
3. Allocate (equal = auto, percentage = assign %, manual = assign exact amounts)
4. Validate: percentage must total 100%, manual must have zero remainder
5. Save

No custom ratios (covered by manual mode). No recurring expenses. No categories.

---

## Theming: Telegram CSS Variables (decided Phase 5)

**Decision:** Follow Telegram's theme via CSS variables. No user-facing dark/light toggle.

**Why:** Telegram Mini Apps already have dark/light mode controlled by the user's Telegram settings. A separate toggle is redundant and confusing. Telegram injects 15 `--tg-theme-*` CSS variables that auto-update when the user changes theme.

**Implementation:** Map Telegram's CSS variables to Tailwind custom colors in `tailwind.config.js`:

```js
colors: {
  tg: {
    bg: 'var(--tg-theme-bg-color)',
    text: 'var(--tg-theme-text-color)',
    hint: 'var(--tg-theme-hint-color)',
    link: 'var(--tg-theme-link-color)',
    button: 'var(--tg-theme-button-color)',
    'button-text': 'var(--tg-theme-button-text-color)',
    'secondary-bg': 'var(--tg-theme-secondary-bg-color)',
    accent: 'var(--tg-theme-accent-text-color)',
    destructive: 'var(--tg-theme-destructive-text-color)',
    subtitle: 'var(--tg-theme-subtitle-text-color)',
    section: 'var(--tg-theme-section-bg-color)',
    'section-header': 'var(--tg-theme-section-header-text-color)',
    separator: 'var(--tg-theme-section-separator-color)',
    header: 'var(--tg-theme-header-bg-color)',
    'bottom-bar': 'var(--tg-theme-bottom-bar-bg-color)',
  }
}
```

Usage: `bg-tg-bg text-tg-text` — no `dark:` prefixes needed. CSS variables handle both modes automatically. Theme changes trigger `themeChanged` event; CSS vars update without manual listeners.

See `work_docs/research/done/5-themes-and-persistence.md` for full analysis.

---

## User Preference Persistence: Telegram CloudStorage (decided Phase 5)

**Decision:** Use Telegram CloudStorage for language preference. No persistence needed for theme (follows Telegram).

**Why not localStorage:** Unreliable in TG WebView — iOS WKWebView can clear it between app restarts or under memory pressure. No cross-device sync.

**Why CloudStorage:** Built-in Telegram API (Bot API 6.9), cloud-synced across devices, 1024 items × 4KB. No backend changes needed.

**What's stored:** `lang` key only (e.g., `"ru"`, `"es"`). Theme follows Telegram automatically — no persistence.

**Init flow:** Read `lang` from CloudStorage → if present, use it (user explicitly chose a language) → otherwise apply `locale` from auth response (server-side `resolveLocale()` maps TG `language_code` with prefix matching, e.g. `pt-BR` → `pt`) → fallback to English.

**What this eliminates:** No `users.language` DB column, no preferences API endpoint, no localStorage, no conflict resolution.

---

## i18n: react-i18next (decided Phase 5)

**Decision:** Use `react-i18next` (i18next + react-i18next). No custom solution.

**Why:** ~80-120 unique UI strings, heavy interpolation ("You owe {{name}} {{amount}}"), and Russian plural forms (3 forms: 1/2-4/5+) rule out a simple JSON lookup. i18next handles CLDR plural rules out of the box, adds ~15KB gzipped (negligible), and uses translator-friendly JSON format.

**Structure:**

```
frontend/src/i18n/
  en.json    — English (base)
  ru.json    — Russian
  es.json    — Spanish
  index.ts   — i18next init, locale detection from TG language_code
```

**Fallback:** Dev mode shows raw keys for missing translations. Production falls back to English.

See `work_docs/research/5-i18n-approach.md` for full analysis.

---

## Smart Contract: SplitogramSettlement (Phase 10)

**Location:** `contracts/splitogram-contract/` (Blueprint project, separate from main Bun workspace)

**What it does:** Receives USDT Jetton transfers, takes a commission (1%, clamped to 0.1–1.0 USDT), forwards the remainder to the recipient. Trustless, atomic, auditable on-chain.

**Flow:** User A sends USDT to contract with recipient (User B) in `forward_payload` → contract splits into two outgoing Jetton transfers (remainder → B, commission → owner).

**Key addresses (testnet):**

| Entity              | Address                                            |
| ------------------- | -------------------------------------------------- |
| Contract (v4)       | `EQBWECX8nJ3lk-90IdgLHoINEYvpmACCGnrqT0rTYH0mjgRu` |
| tUSDT Jetton Master | `kQBDzVlfzubS8ONL25kQNrjoVMF-NwyECbJOfKndeyseWAV7` |
| Owner (Wallet C)    | `0QAoBJzd06D3xzxrdCiF38ZnVyOVDCTZPKmQnrWO-2RfU9pq` |

**Mainnet USDT Master:** `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs`

**Owner messages:** `UpdateCommission`, `WithdrawTon`, `SetJettonWallet`

**Getters:** `commission()`, `stats()` (total_processed, total_commission, settlement_count), `jetton_wallet()`

**Tests:** 17 sandbox tests via `@ton/sandbox` (deploy, settlement split, min/max commission, permissions, accumulation, invalid payloads, unconfigured rejection)

**Direct transfer fallback:** For small settlements where gas cost > N% of amount, the app will do a direct wallet-to-wallet USDT transfer instead (no commission, lower gas). Deferred to mainnet optimization.

**Exchange rate service:** `backend/src/services/exchange-rates.ts` — fetches from open.er-api.com (with jsdelivr fallback), caches in D1 `exchange_rates` table (24h TTL). Used by `/settlements/:id/tx` to convert non-USD group currencies to USDT amounts.

**Frontend integration:** TON Connect UI provider in App.tsx. `useTonWallet()` hook syncs wallet address to backend. SettleUp page has 6-state machine (idle → preflight → confirm → sending → polling → success). `frontend/src/utils/ton.ts` builds Jetton transfer message body.

See `work_docs/smart-contract.md` for full design and `work_docs/smart-contract-testnet-plan.md` for deployment plan.

---

## Key Engineering Principles

- **CLAUDE.md first** — project description, commands, architecture, conventions before code
- **API versioning** — all routes under `/api/v1`
- **Consistent error shape** — `{error: "machine_code", detail: "human message"}`
- **Zod at the boundary** — validate all inputs via `@hono/zod-validator`
- **Timeout on every I/O** — `AbortSignal.timeout()` on TONAPI, bot API calls
- **Stateless handlers** — debt calculation, verification are pure functions
- **Stateless auth** — HMAC verification per request, no sessions
- **Integration tests over mocks** — hit real D1 (wrangler local), real bot API
- **Fire-and-forget notifications** — `executionCtx.waitUntil()` for bot sends
- **No categories, no recurring expenses** — explicitly out of scope

---

## Template Origin

Scaffolded from `/Users/dmitrykozlov/repos/telegram-webapp-cloudflare-template`. Auth, session management, middleware, CI/CD pipeline, TG hooks, API client pattern all came from template. Domain code (groups, expenses, balances, settlement) is original.

---

## DB Migrations

| Migration | What                                                   | Phase |
| --------- | ------------------------------------------------------ | ----- |
| 0000      | Initial schema                                         | 1     |
| 0001      | Settlement comment + settledBy columns                 | 2     |
| 0002      | Group currency column                                  | 2     |
| 0003      | users.botStarted + group_members.muted                 | 2     |
| 0004      | avatar_key (users, groups), avatar_emoji, receipt keys | 6     |
| 0005      | activity_log + debt_reminders tables                   | 7     |
| 0006      | expenses.split_mode + settlements receipt keys         | 8     |
| 0007      | users.is_dummy column                                  | —     |
| 0008      | exchange_rates table                                   | 10    |
| 0009      | settlements.usdtAmount + commission columns            | 10    |

---

## Research & Decisions

Each has a dedicated file in `work_docs/research/`:

| Topic                           | Phase | Status      | File                                                        |
| ------------------------------- | ----- | ----------- | ----------------------------------------------------------- |
| Frontend framework / UI lib     | 3     | Done        | `done/3-frontend-framework.md` — no library, React+Tailwind |
| Balance integrity rules         | 4     | Done        | `done/4-balance-integrity.md`                               |
| Themes & preference persistence | 5     | Done        | `done/5-themes-and-persistence.md` — TG theme, CloudStorage |
| i18n approach                   | 5     | Done        | `done/5-i18n-approach.md` — react-i18next                   |
| Image storage (R2)              | 6     | Done        | `done/6-image-storage-r2.md`                                |
| Exchange rates                  | 10    | Implemented | `10-exchange-rates.md` — open.er-api.com + D1 cache         |
| TON Connect & crypto            | 10    | Implemented | `10-ton-connect-crypto.md` — testnet working                |
| Growth & virality               | 9     | Skipped     | `skipped/9-growth-virality.md`                              |
| AI & monetization               | 11    | Pending     | `11-ai-monetization.md`                                     |
