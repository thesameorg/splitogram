# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Splitogram — Telegram Mini App for splitting group expenses with on-chain USDT settlement on TON blockchain. Splitwise meets Telegram Wallet.

## Commands

```bash
# Install
bun install

# Dev (backend + frontend in parallel)
bun run dev

# Backend only (Cloudflare Worker via wrangler)
bun run dev:backend          # starts on localhost:8787

# Frontend only (Vite dev server, proxies /api to :8787)
bun run dev:frontend         # starts on localhost:5173

# Database
bun run db:generate          # generate migration from schema changes
bun run db:migrate:local     # apply migrations to local D1

# Test
bun run test                 # run all tests (backend + frontend)
bun run test:backend         # backend tests only
bun run test:frontend        # frontend tests only
# Single test file:
cd backend && bunx vitest run tests/debt-solver.test.ts

# Lint, typecheck, format
bun run typecheck             # typecheck backend + frontend
bun run lint                  # placeholder (echo 'lint ok') — no ESLint yet
bun run format                # prettier --write .
bun run format:check          # prettier --check . (CI-friendly)
bun run check                 # typecheck + lint + test (all at once)

# Tunnel & webhook (for bot testing)
bun run tunnel:start         # ngrok tunnel on :5173 (Vite, proxies API+webhook to :8787)
bun run tunnel:stop          # stop ngrok
bun run webhook:set          # set bot webhook to current tunnel URL
bun run webhook:status       # check webhook config
bun run webhook:clear        # remove webhook (back to long polling)

# Deploy (CI does this, but manual if needed)
bun run deploy               # deploy worker to Cloudflare
```

## Local Development Setup

Full local setup: backend + frontend + bot webhook via ngrok tunnel.

### Prerequisites

- Bun, ngrok, jq installed
- `.env` file with `TELEGRAM_BOT_TOKEN`, `VITE_TELEGRAM_BOT_USERNAME`
- `.dev.vars` file with secrets for wrangler (TELEGRAM_BOT_TOKEN, DEV_AUTH_BYPASS_ENABLED, TONAPI_KEY, USDT_MASTER_ADDRESS, PAGES_URL, ADMIN_TELEGRAM_ID, ADMIN_SECRET)

### Steps

```bash
bun install
bun run db:generate            # if schema changed
bun run db:migrate:local       # apply migrations to local D1

# Terminal 1: backend
bun run dev:backend            # wrangler dev on :8787

# Terminal 2: frontend
bun run dev:frontend           # vite dev on :5173

# Terminal 3: tunnel + webhook
bun run tunnel:start           # ngrok → :5173 (Vite proxies /api, /webhook to :8787)
bun run webhook:set            # point bot webhook to tunnel
```

### Key details

- **Tunnel points to Vite (5173), not wrangler (8787).** Vite proxies `/api/*`, `/webhook`, `/r2`, and `/admin` to the backend. This way one tunnel serves both the Mini App frontend and the bot webhook.
- **`.dev.vars` PAGES_URL** must match the current ngrok URL (changes every restart on free tier). Update it and restart wrangler when tunnel URL changes.
- **`DEV_AUTH_BYPASS_ENABLED=true`** in `.dev.vars` skips TG initData validation, auto-creates a mock "DEV Developer" user.
- **Frontend build** (`bun run build:frontend`) is NOT required for local dev — Vite serves hot-reloaded source. Only needed if testing wrangler pages serving.
- **Stopping:** `bun run stop` kills wrangler+vite. `bun run tunnel:stop` kills ngrok.

## Architecture

### Deployment: Cloudflare

```
Cloudflare Pages          Cloudflare Worker              Cloudflare D1 (SQLite)
(frontend static)    →    (API + bot webhook)      →     Cloudflare R2 (image storage)
React + Vite + Tailwind    Hono + grammY + Drizzle        TONAPI (external REST)

TON Blockchain
SplitogramSettlement (Tact)  →  USDT settlement with commission split
```

- **Backend** runs as a single Cloudflare Worker handling both API routes and Telegram bot webhook
- **Frontend** is a static React app on Cloudflare Pages
- **Database** is Cloudflare D1 (SQLite) accessed via Drizzle ORM
- **Auth** is stateless HMAC verification of Telegram `initData` per request — no sessions, no KV. Auth middleware stores `userId` (internal DB PK) in `SessionData` so route handlers never need a redundant D1 user lookup.
- **Frontend UI** is plain React + Tailwind + react-i18next (no component library — decided Phase 3). Theming via Telegram CSS variables mapped to `tg-*` Tailwind tokens.
- **Image storage** is Cloudflare R2, served via Worker at `/r2/*` with Cloudflare Cache API edge caching + immutable browser caching. Client-side resize/compress via Canvas API (zero deps). One bucket with `avatars/`, `groups/`, `receipts/` prefixes.
- **TON verification** via TONAPI REST API (plain `fetch`, no SDK on backend)
- **Smart contract** is a Tact contract (`contracts/splitogram-contract/`) deployed on TON testnet. Receives USDT, takes 1% commission (min 0.1, max 1.0 USDT), forwards remainder to recipient. Built with Blueprint SDK, tested with `@ton/sandbox`.

### Bun Workspaces

Root `package.json` defines `workspaces: ["backend", "frontend", "packages/*"]`. A single `bun install` at root installs all. Root scripts delegate to workspace scripts (e.g., `bun run test:backend` → `cd backend && bun run test`). Shared code lives in `packages/shared/` (`@splitogram/shared`).

### Repo Structure

```
packages/shared/src/
├── currencies.ts         # 150+ currency configs (canonical source)
├── commission.ts         # calculateCommission (mirrors smart contract: 1% clamped [0.1, 1.0] USDT)
├── format.ts             # formatAmount, formatSignedAmount (canonical source)
└── index.ts              # Barrel re-export

backend/src/
├── index.ts              # Hono app entry, routes, middleware, error handler
├── webhook.ts            # grammY bot (module-level cached): /start, /stats, deep links, report moderation callbacks
├── env.ts                # Env bindings (D1, R2, secrets) + SessionData type
├── api/                  # Route handlers (auth, users, groups/*, expenses, balances, settlements, activity, stats, r2, admin, reports)
│   └── groups/           # Split into core.ts (CRUD/avatar), membership.ts (join/leave/kick/reminders), placeholders.ts, export.ts
├── middleware/            # auth (initData HMAC validation), db (Drizzle injection)
├── services/             # telegram-auth, notifications, debt-solver, activity, moderation, exchange-rates, tonapi
├── utils/                # currencies, format, commission, notify-ctx (re-export from @splitogram/shared), r2 (key gen, safe delete)
├── db/
│   ├── index.ts          # Drizzle factory for D1
│   └── schema.ts         # All table definitions
├── dev/                  # Dev-only utilities (mock user for auth bypass)
└── models/               # Zod request/response schemas

frontend/src/
├── App.tsx               # TG SDK init + AppLayout router + deep link handling
├── i18n.ts               # react-i18next config, language detection, CloudStorage persistence
├── locales/              # Translation JSON files (en, ru, es, hi, id, fa, pt, uk, de, it, vi)
├── services/api.ts       # Fetch wrapper with initData auth header
├── pages/                # Home, Group, GroupSettings, AddExpense, SettleUp, Activity, Account
├── icons/                # SVG icon components (IconUsers, IconActivity, IconUser, IconCopy, IconCrown, IconCheck)
├── contexts/             # UserContext (avatar/name/isAdmin state for BottomTabs + Account)
├── utils/                # currencies, format, commission, time, share, transactions, image
├── components/           # PageLayout, LoadingScreen, ErrorBanner, SuccessBanner, BottomSheet, AppLayout, BottomTabs, CurrencyPicker, Avatar, DonutChart, MonthSelector
└── hooks/                # useAuth, useCurrentUser, useTelegramBackButton, useTelegramMainButton

contracts/splitogram-contract/    # Separate npm project (not Bun workspace)
├── contracts/SplitogramSettlement.tact  # Settlement contract (Tact)
├── tests/SplitogramSettlement.spec.ts   # 16 sandbox tests
├── scripts/                             # Deploy + test scripts (Blueprint)
├── wrappers/                            # Auto-generated TS wrappers
└── build/                               # Compiled contract artifacts
```

### Hono Context Types

The backend uses Hono's typed context pattern to pass data through middleware. This is a key pattern to understand:

```ts
// middleware/auth.ts — sets session on context
export type AuthContext = { Bindings: Env; Variables: { session: SessionData } };
// SessionData: { telegramId, userId, username?, displayName }

// middleware/db.ts — sets Drizzle instance on context
export type DBContext = { Bindings: Env; Variables: { db: Database } };

// Route handlers use intersection types to require both:
type GroupEnv = AuthContext & DBContext;
const app = new Hono<GroupEnv>();
app.get('/', (c) => {
  const db = c.get('db'); // from dbMiddleware
  const session = c.get('session'); // from authMiddleware
  const userId = session.userId; // internal DB PK — no extra D1 lookup needed
});
```

Middleware registration order matters — `dbMiddleware` is global (all routes), `authMiddleware` is applied per-prefix before `app.route()`:

```ts
app.use('/api/v1/groups/*', authMiddleware); // must come before .route()
app.route('/api/v1/groups', groupsApp);
```

### Request Flow

1. Mini App loads → calls `POST /api/v1/auth` to upsert user (register/update profile in D1)
2. Every API request sends `Authorization: tma <initData>` header
3. Auth middleware validates HMAC-SHA256 signature, looks up user in D1, sets session context
4. Bot webhook at `POST /webhook` — grammY handles /start commands, deep links, and report moderation callback queries

### Deep Links (Bot → Mini App)

Bot sends links with `start_param`. Frontend reads `window.Telegram.WebApp.initDataUnsafe.start_param` in App.tsx and routes to the matching page after auth completes. Patterns:

- `group_{id}` → navigate to group page
- `join_{inviteCode}` → auto-resolve invite, join group, navigate to group
- `jp_{inviteCode}_{placeholderId}` → join group + auto-claim placeholder (personalized invite)
- `settle_{id}` → navigate to settlement page
- `expense_{id}` → navigate to home (no standalone page yet)

### Data Model

- **users**: telegram_id, username, display_name, wallet_address, bot_started, avatar_key, is_dummy
- **groups**: name, invite_code, is_pair, currency (default 'USD'), created_by, avatar_key, avatar_emoji, deleted_at (soft-delete)
- **group_members**: group_id, user_id, role (admin/member), muted, net_balance (cached, updated on mutations)
- **expenses**: group_id, paid_by, amount (micro-units integer), description, receipt_key, receipt_thumb_key
- **expense_participants**: expense_id, user_id, share_amount
- **settlements**: group_id, from_user, to_user, amount, status (open/payment_pending/settled_onchain/settled_external), tx_hash, usdt_amount, commission, comment, settled_by
- **activity_log**: group_id, actor_id, type (expense_created/edited/deleted, settlement_completed, member_joined/left/kicked, placeholder_claimed), target_user_id, expense_id, settlement_id, amount, metadata (JSON), created_at
- **debt_reminders**: group_id, from_user_id (creditor), to_user_id (debtor), last_sent_at (24h cooldown)
- **image_reports**: reporter_telegram_id, image_key, reason, details, status (pending/rejected/removed)

Amounts stored as integers in micro-units (1 unit = 1,000,000). Currency is per-group. No floating point.

### Settlement Flow (Phase 2 — Manual)

1. User taps "Settle up" on a balance → `POST /api/v1/groups/:id/settlements` creates settlement from debt graph
2. Frontend navigates to `/settle/:id` showing settlement details
3. Either party (debtor or creditor) taps "Mark as Settled" with optional comment
4. `POST /api/v1/settlements/:id/settle` → status → `settled_external`, records who settled and comment
5. Both parties get bot notification (if not muted and bot started)

### Settlement Flow (Phase 10 — On-chain USDT)

1. Debtor taps "Pay with USDT" → `GET /api/v1/settlements/:id/tx?senderAddress=...` runs preflight:
   - Looks up sender's USDT Jetton Wallet via TONAPI
   - Checks USDT balance ≥ debt + commission
   - Calculates gas: empirical constants from testnet profiling (see `work_docs/tonfees.md`)
   - Checks TON balance ≥ gas attach
   - Returns `SettlementTxParams` (amounts, addresses, gas values)
2. Frontend shows confirm screen with line-item breakdown (recipient, commission, total in USDT, gas in TON)
3. User confirms → frontend builds Jetton transfer BOC (`frontend/src/utils/ton.ts`) → sends via TON Connect
4. Backend transitions settlement to `payment_pending`, polls for on-chain confirmation
5. `POST /api/v1/settlements/:id/confirm` verifies the transfer on-chain via TONAPI events

### Gas Constants (settlements.ts)

Gas is calculated from empirical testnet profiling. The settlement message chain is always the same (11 messages, 2 recipients: creditor + owner commission), so gas cost is predictable.

```
FORWARD_TON      = 0.3  TON  — contract needs this for 2 outgoing Jetton transfers (0.15 each)
EMPIRICAL_GAS    = 0.1  TON  — measured burn ~0.093 TON, rounded up
GAS_BUFFER       = 25%       — safety margin for network config changes
gasAttach        = FORWARD_TON + EMPIRICAL_GAS + 25% buffer ≈ 0.45 TON (rounded to nearest 0.05)
```

**If transactions start failing with out-of-gas:** Increase `EMPIRICAL_GAS` in `backend/src/api/settlements.ts`. Check a recent failed tx on Tonviewer → compute actual gas burn (attached - excess returned). Set `EMPIRICAL_GAS` to that value rounded up. The 25% buffer handles small fluctuations; if network gas_price changes significantly (validator vote), the constant needs updating. See `work_docs/tonfees.md` for full analysis.

Excess TON is always refunded — `response_destination` points to sender's wallet. Overpaying gas is safe (user gets it back), underpaying causes tx failure.

### Background Work Pattern

Cloudflare Workers terminate after the response is sent. To run fire-and-forget work (e.g., sending Telegram notifications), use `c.executionCtx.waitUntil(promise)` — this keeps the worker alive until the promise resolves without blocking the response. All notification sends use this pattern.

## Conventions

- All API routes under `/api/v1` prefix
- Error responses: `{ error: "machine_code", detail: "human message" }`
- Zod validation on all endpoint inputs via `@hono/zod-validator` — access validated data via `c.req.valid('json')`
- Explicit timeout on every external I/O call (`AbortSignal.timeout()`)
- Bot notifications are fire-and-forget via `waitUntil()` with 1 bounded retry — never block the API response
- Bot 403 handling: catch `GrammyError` 403, set `botStarted = false`, skip non-started users via `canNotify()`
- Per-group mute: `group_members.muted` flag, muted users skip expense notifications
- Health endpoint `GET /api/health` excluded from auth
- Settlements created on demand when user taps "Settle up" (not pre-created)
- **Group soft-delete** — `groups.deleted_at` set on deletion. Expenses, participants, activity_log, debt_reminders, group_members, and non-onchain settlements are hard-deleted. On-chain settlements (`settled_onchain`) and the group row are retained for commission accounting and Tonviewer audit trail. GDPR-compliant: on-chain txs are public blockchain records (legal basis: legitimate interest). Invite/join endpoints filter `deleted_at IS NULL`. User-facing group list filters via `group_members` join (members removed on delete).
- Shared currency utilities in `@splitogram/shared` (`packages/shared/src/currencies.ts` + `format.ts`). Backend/frontend `utils/` re-export from shared package.
- Dev auth bypass via `DEV_AUTH_BYPASS_ENABLED` env var (skips TG initData validation, auto-creates mock user from `backend/src/dev/mock-user.ts`)
- **Theming** — Telegram `--tg-theme-*` CSS vars mapped to Tailwind `tg-*` tokens (e.g., `bg-tg-bg`, `text-tg-hint`, `bg-tg-button`). No `dark:` prefixes — CSS vars handle both modes. Fallback values in `index.css` for dev outside Telegram. Semantic colors (positive/negative/warning) use `--app-*` CSS vars with light/dark variants, mapped to Tailwind `app-*` tokens (e.g., `text-app-positive`, `bg-app-negative-bg`). `data-theme` attribute set from `webApp.colorScheme`.
- **i18n** — `react-i18next` with 11 JSON locale files (`src/locales/{en,ru,es,hi,id,fa,pt,uk,de,it,vi}.json`). All UI strings use `t('key')`. Plurals via `t('key', { count })` (CLDR rules: one/few/many for ru/uk, other-only for id/vi). Locale resolved server-side from TG `language_code` during auth (prefix matching, e.g. `pt-BR` → `pt`, fallback `en`), returned in auth response, applied on frontend unless user has a persisted CloudStorage preference. Selectable on Account page via BottomSheet picker with flags.
- **Feedback** — `POST /api/v1/users/feedback` accepts multipart FormData (message + up to 5 attachments). Text sent as bot DM, attachments forwarded as photos/documents. Fire-and-forget via `waitUntil()`.
- **Content moderation** — `POST /api/v1/reports` stores report in `image_reports` table and sends reported image as photo to admin with inline keyboard (Reject/Remove). Bot `callback_query:data` handler in webhook.ts looks up report by ID from DB (callback_data: `rj|{id}` / `rm|{id}` — avoids Telegram's 64-byte limit). Reject/Remove update report status, notify reporter, edit caption. Image removal via `removeImage()` in `services/moderation.ts`.
- **Legal pages** — Privacy Policy (`/privacy`) and Terms of Service (`/terms`) served as Worker HTML routes. Source of truth is `docs/privacy-policy.md` and `docs/terms-of-service.md` — imported as raw text via wrangler `Text` rule, converted to HTML with `marked` at module init. Public, no auth. Opened from Account page via `WebApp.openLink()`. Vite proxy includes `/privacy` and `/terms` for local dev.
- **Admin dashboard** — Plain HTML at `/admin`, served from the Worker (no React). Protected by `hono/basic-auth` with `ADMIN_SECRET` env var (needed because the page opens in an external browser where TG `initData` is unavailable). Shows metrics (users, groups, expenses, settlements, active groups, on-chain volume/fees), paginated groups table (with soft-deleted groups toggle), on-chain transactions table with Tonviewer links, group detail with members (placeholder badge)/expenses/settlements/images, and image delete. Testnet badge shown when `TON_NETWORK !== 'mainnet'`. Bot `/stats` command (admin TG ID only) provides quick metrics via DM. Frontend link uses `config.apiBaseUrl` (Worker URL) as base — not `window.location.origin` (Pages domain) — so the browser hits the Worker directly. Vite proxy includes `/admin` for local dev.
- **`isAdmin` flag** — Auth response includes `isAdmin: boolean` (compares `telegramId` to `ADMIN_TELEGRAM_ID`). Propagated through `useAuth` → `UserContext` → Account page, which shows an "Admin Dashboard" link that opens `/admin` in external browser via `WebApp.openLink()`.
- **Placeholder members** — "dummy" users for people not on the app. `users.is_dummy = true` with negative `telegramId` (real TG IDs are always positive, keeps unique constraint). Admin-only creation via `POST /groups/:id/placeholders` in GroupSettings. Placeholders participate fully in expenses and manual settlements (no on-chain). Shown with 👤 badge in member lists, payer dropdown, participant chips. Admin can rename (`PUT`) or delete (`DELETE`, zero balance required). Real users can claim a placeholder via `POST /groups/:id/claim-placeholder` — merges all FK references (expenses.paid*by, expense_participants, settlements, activity_log) from dummy to real user, deletes dummy. Claim UI: banner on Group page ("Are you one of these people?") with balance preview before confirming. **One claim per user per group** — enforced via `placeholder_claimed` activity_log event check. **Claim eligibility** — only placeholders that existed when the user joined are claimable (compares `groupMembers.joinedAt` timestamps); backend enforces `placeholder_created_after_join` error. Placeholder debt cards show "Invite" button (personalized invite link with `jp*{inviteCode}\_{placeholderId}` deep link — auto-claims on join) instead of "Send Reminder". "Invite" button also shown on balance cards with no debt relationship. GroupSettings "Invite" shares personalized link (not generic). Bot message for personalized invites mentions placeholder name.
- **Versioning** — Git commit hash injected at build time via Vite `define` (`__APP_VERSION__`). Displayed as subtle `v{hash}` footer on Account page.

## Code Style

Prettier config (`.prettierrc`): single quotes, trailing commas, semicolons, 100 char width, 2-space indent. Run `bun run format` before committing.

## CI/CD Pipeline

Push to `main` triggers `.github/workflows/deploy-pipeline.yml` which orchestrates 4 steps in sequence:

1. **Build & Test** — lint + typecheck + tests (backend & frontend in parallel)
2. **Deploy Worker** — D1 migrations → secrets → `wrangler deploy` → health check
3. **Deploy Pages** — build frontend → deploy to Cloudflare Pages
4. **Setup Webhook** — configure Telegram bot webhook to worker URL

## Planning Docs

- `docs/architecture.md` — stack, architecture, key engineering principles
- `docs/idea.md` — business overview and competitive landscape
- `docs/smart-contract.md` — TON settlement contract manual
- `docs/envs.md` — TON-related environment variables
- `docs/mainnet-migration.md` — testnet → mainnet migration checklist
- `docs/TWA-checklist.md` — Telegram Mini App listing requirements
- `work_docs/CODE_REVIEW.md` — code review findings (3 critical + 7 major all fixed, 8 minor remaining)
