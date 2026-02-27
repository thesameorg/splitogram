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
(frontend static)    →    (API + bot webhook)      →     Cloudflare KV (sessions)
React + Vite               Hono + grammY + Drizzle        TONAPI (external REST)
TON Connect UI
```

- **Backend** runs as a single Cloudflare Worker handling both API routes and Telegram bot webhook
- **Frontend** is a static React app on Cloudflare Pages
- **Database** is Cloudflare D1 (SQLite) accessed via Drizzle ORM
- **Sessions** stored in Cloudflare KV with 1-hour TTL
- **TON verification** via TONAPI REST API (plain `fetch`, no SDK on backend)
- **TON transactions** constructed on frontend via `@ton/ton`, sent via `@tonconnect/ui-react`

### Bun Workspaces

Root `package.json` defines `workspaces: ["backend", "frontend"]`. A single `bun install` at root installs both. Root scripts delegate to workspace scripts (e.g., `bun run test:backend` → `cd backend && bun run test`).

### Repo Structure

```
backend/src/
├── index.ts              # Hono app entry, routes, middleware, error handler
├── webhook.ts            # grammY bot: /start, deep links, notification handlers
├── env.ts                # Zod schema for Env bindings
├── api/                  # Route handlers (auth, groups, expenses, balances, settlement)
├── middleware/            # auth (session validation), db (Drizzle injection)
├── services/             # telegram-auth, session, notifications, debt-solver, ton-verify
├── db/
│   ├── index.ts          # Drizzle factory for D1
│   └── schema.ts         # All table definitions
├── dev/                  # Dev-only utilities (mock user for auth bypass)
└── models/               # Zod request/response schemas

frontend/src/
├── App.tsx               # TG SDK init + TonConnectUIProvider + router + deep link handling
├── services/api.ts       # Fetch wrapper with session header injection
├── pages/                # Home, Group, AddExpense, SettleUp
├── components/
└── hooks/                # TG back button, main button, etc.
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
  const db = c.get('db');           // from dbMiddleware
  const session = c.get('session'); // from authMiddleware
});
```

Middleware registration order matters — `dbMiddleware` is global (all routes), `authMiddleware` is applied per-prefix before `app.route()`:
```ts
app.use('/api/v1/groups/*', authMiddleware);  // must come before .route()
app.route('/api/v1/groups', groupsApp);
```

### Request Flow

1. Mini App loads → reads `initData` from TG WebApp context
2. `POST /api/v1/auth` with initData → backend validates HMAC-SHA256 signature → creates KV session (1h TTL, auto-expires) → returns session ID
3. All subsequent requests include `Authorization: Bearer {sessionId}`
4. Auth middleware validates session from KV on every request
5. Bot webhook at `POST /webhook` — grammY handles /start commands and deep links

### Deep Links (Bot → Mini App)

Bot sends links with `start_param` (e.g., `group_123`). Frontend reads `window.Telegram.WebApp.initDataUnsafe.start_param` in App.tsx and routes to the matching page after auth completes. Patterns: `group_{id}`, `settle_{id}`, `expense_{id}`.

### Data Model

- **users**: telegram_id, username, display_name, wallet_address
- **groups**: name, invite_code, is_pair (for 1-on-1)
- **group_members**: group_id, user_id, role
- **expenses**: group_id, paid_by, amount (micro-USDT integer), description
- **expense_participants**: expense_id, user_id, share_amount
- **settlements**: group_id, from_user, to_user, amount, status (open/payment_pending/settled_onchain/settled_external), tx_hash

Amounts stored as integers in micro-USDT (1 USDT = 1,000,000). No floating point.

### Settlement Flow

1. User taps "Settle up" → frontend calls `POST /api/v1/groups/:id/settlements` (creates settlement on demand from debt graph)
2. Frontend calls `GET /api/v1/settlements/:id/tx` → backend returns Jetton transfer payload (recipient, amount, memo)
3. Frontend sends tx via `tonConnectUI.sendTransaction()` → user approves in wallet
4. Frontend sends BOC to `POST /api/v1/settlements/:id/verify`
5. Backend verifies on TONAPI: correct sender, recipient, amount, memo
6. On success: status → `settled_onchain`. On failure: user can tap "Refresh status" to re-check or rollback to `open`

### Background Work Pattern

Cloudflare Workers terminate after the response is sent. To run fire-and-forget work (e.g., sending Telegram notifications), use `c.executionCtx.waitUntil(promise)` — this keeps the worker alive until the promise resolves without blocking the response. All notification sends use this pattern.

## Conventions

- All API routes under `/api/v1` prefix
- Error responses: `{ error: "machine_code", detail: "human message" }`
- Zod validation on all endpoint inputs via `@hono/zod-validator` — access validated data via `c.req.valid('json')`
- Explicit timeout on every external I/O call (`AbortSignal.timeout()`)
- Bot notifications are fire-and-forget via `waitUntil()` with 1 bounded retry — never block the API response
- Health endpoint `GET /api/health` excluded from auth
- Settlements created on demand when user taps "Settle up" (not pre-created)
- USDT master contract address env-switched via `USDT_MASTER_ADDRESS` (different for testnet/mainnet)
- Dev auth bypass via `DEV_AUTH_BYPASS_ENABLED` env var (skips TG initData validation, auto-creates mock user from `backend/src/dev/mock-user.ts`)

## Code Style

Prettier config (`.prettierrc`): single quotes, trailing commas, semicolons, 100 char width, 2-space indent. Run `bun run format` before committing.

## CI/CD Pipeline

Push to `main` triggers `.github/workflows/deploy-pipeline.yml` which orchestrates 4 steps in sequence:
1. **Build & Test** — lint + typecheck + tests (backend & frontend in parallel)
2. **Deploy Worker** — D1 migrations → secrets → `wrangler deploy` → health check
3. **Deploy Pages** — build frontend → deploy to Cloudflare Pages
4. **Setup Webhook** — configure Telegram bot webhook to worker URL

## Planning Docs

- `work_docs/phases.md` — 9-phase roadmap
- `work_docs/phase_1/` — Phase 1 task breakdown with tech details per task group
