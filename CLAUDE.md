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
- `.dev.vars` file with secrets for wrangler (TELEGRAM_BOT_TOKEN, DEV_AUTH_BYPASS_ENABLED, TONAPI_KEY, USDT_MASTER_ADDRESS, PAGES_URL)

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

- **Tunnel points to Vite (5173), not wrangler (8787).** Vite proxies `/api/*` and `/webhook` to the backend. This way one tunnel serves both the Mini App frontend and the bot webhook.
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
```

- **Backend** runs as a single Cloudflare Worker handling both API routes and Telegram bot webhook
- **Frontend** is a static React app on Cloudflare Pages
- **Database** is Cloudflare D1 (SQLite) accessed via Drizzle ORM
- **Auth** is stateless HMAC verification of Telegram `initData` per request — no sessions, no KV
- **Frontend UI** is plain React + Tailwind + react-i18next (no component library — decided Phase 3). Theming via Telegram CSS variables mapped to `tg-*` Tailwind tokens.
- **Image storage** is Cloudflare R2, served via Worker at `/r2/*` with immutable caching. Client-side resize/compress via Canvas API (zero deps). One bucket with `avatars/`, `groups/`, `receipts/` prefixes.
- **TON verification** via TONAPI REST API (plain `fetch`, no SDK on backend, deferred to Phase 10)

### Bun Workspaces

Root `package.json` defines `workspaces: ["backend", "frontend"]`. A single `bun install` at root installs both. Root scripts delegate to workspace scripts (e.g., `bun run test:backend` → `cd backend && bun run test`).

### Repo Structure

```
backend/src/
├── index.ts              # Hono app entry, routes, middleware, error handler
├── webhook.ts            # grammY bot: /start, deep links, botStarted tracking, report moderation callbacks
├── env.ts                # Env bindings (D1, R2, secrets) + SessionData type
├── api/                  # Route handlers (auth, users, groups, expenses, balances, settlements, activity, r2)
├── middleware/            # auth (initData HMAC validation), db (Drizzle injection)
├── services/             # telegram-auth, notifications, debt-solver, activity
├── utils/                # currencies, format (shared with frontend), r2 (key gen, safe delete)
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
├── contexts/             # UserContext (avatar/name state for BottomTabs + Account)
├── utils/                # currencies, format, time, share, transactions, image
├── components/           # PageLayout, LoadingScreen, ErrorBanner, SuccessBanner, BottomSheet, AppLayout, BottomTabs, CurrencyPicker, Avatar
└── hooks/                # useAuth, useCurrentUser, useTelegramBackButton, useTelegramMainButton
```

### Hono Context Types

The backend uses Hono's typed context pattern to pass data through middleware. This is a key pattern to understand:

```ts
// middleware/auth.ts — sets session on context
export type AuthContext = { Bindings: Env; Variables: { session: SessionData } };

// middleware/db.ts — sets Drizzle instance on context
export type DBContext = { Bindings: Env; Variables: { db: Database } };

// Route handlers use intersection types to require both:
type GroupEnv = AuthContext & DBContext;
const app = new Hono<GroupEnv>();
app.get('/', (c) => {
  const db = c.get('db'); // from dbMiddleware
  const session = c.get('session'); // from authMiddleware
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
- `settle_{id}` → navigate to settlement page
- `expense_{id}` → navigate to home (no standalone page yet)

### Data Model

- **users**: telegram_id, username, display_name, wallet_address, bot_started, avatar_key
- **groups**: name, invite_code, is_pair, currency (default 'USD'), created_by, avatar_key, avatar_emoji
- **group_members**: group_id, user_id, role (admin/member), muted
- **expenses**: group_id, paid_by, amount (micro-units integer), description, receipt_key, receipt_thumb_key
- **expense_participants**: expense_id, user_id, share_amount
- **settlements**: group_id, from_user, to_user, amount, status (open/payment_pending/settled_onchain/settled_external), tx_hash, comment, settled_by
- **activity_log**: group_id, actor_id, type (expense_created/edited/deleted, settlement_completed, member_joined/left/kicked), target_user_id, expense_id, settlement_id, amount, metadata (JSON), created_at
- **debt_reminders**: group_id, from_user_id (creditor), to_user_id (debtor), last_sent_at (24h cooldown)

Amounts stored as integers in micro-units (1 unit = 1,000,000). Currency is per-group. No floating point.

### Settlement Flow (Phase 2 — Manual)

1. User taps "Settle up" on a balance → `POST /api/v1/groups/:id/settlements` creates settlement from debt graph
2. Frontend navigates to `/settle/:id` showing settlement details
3. Either party (debtor or creditor) taps "Mark as Settled" with optional comment
4. `POST /api/v1/settlements/:id/settle` → status → `settled_external`, records who settled and comment
5. Both parties get bot notification (if not muted and bot started)

On-chain USDT settlement deferred to Phase 10 (will add `settled_onchain` path via TON Connect).

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
- Shared currency utilities in `utils/currencies.ts` + `utils/format.ts` (both backend and frontend)
- Dev auth bypass via `DEV_AUTH_BYPASS_ENABLED` env var (skips TG initData validation, auto-creates mock user from `backend/src/dev/mock-user.ts`)
- **Theming** — Telegram `--tg-theme-*` CSS vars mapped to Tailwind `tg-*` tokens (e.g., `bg-tg-bg`, `text-tg-hint`, `bg-tg-button`). No `dark:` prefixes — CSS vars handle both modes. Fallback values in `index.css` for dev outside Telegram. Semantic colors (positive/negative/warning) use `--app-*` CSS vars with light/dark variants, mapped to Tailwind `app-*` tokens (e.g., `text-app-positive`, `bg-app-negative-bg`). `data-theme` attribute set from `webApp.colorScheme`.
- **i18n** — `react-i18next` with 11 JSON locale files (`src/locales/{en,ru,es,hi,id,fa,pt,uk,de,it,vi}.json`). All UI strings use `t('key')`. Plurals via `t('key', { count })` (CLDR rules: one/few/many for ru/uk, other-only for id/vi). Language detected from TG user, persisted in CloudStorage, selectable on Account page via BottomSheet picker with flags.
- **Feedback** — `POST /api/v1/users/feedback` accepts multipart FormData (message + up to 5 attachments). Text sent as bot DM, attachments forwarded as photos/documents. Fire-and-forget via `waitUntil()`.
- **Content moderation** — `POST /api/v1/reports` sends reported image as photo to admin with inline keyboard (Reject/Remove). Bot `callback_query:data` handler in webhook.ts processes admin actions: Reject notifies reporter, Remove deletes image from R2 and notifies reporter. Both actions edit original caption and remove buttons.

## Code Style

Prettier config (`.prettierrc`): single quotes, trailing commas, semicolons, 100 char width, 2-space indent. Run `bun run format` before committing.

## CI/CD Pipeline

Push to `main` triggers `.github/workflows/deploy-pipeline.yml` which orchestrates 4 steps in sequence:

1. **Build & Test** — lint + typecheck + tests (backend & frontend in parallel)
2. **Deploy Worker** — D1 migrations → secrets → `wrangler deploy` → health check
3. **Deploy Pages** — build frontend → deploy to Cloudflare Pages
4. **Setup Webhook** — configure Telegram bot webhook to worker URL

## Planning Docs

- `work_docs/PLAN.md` — 10-phase roadmap (Phase 1-7 done, Phase 8 next)
- `work_docs/tech-decisions.md` — stack, architecture, key engineering principles
- `work_docs/idea.md` — business overview and competitive landscape
