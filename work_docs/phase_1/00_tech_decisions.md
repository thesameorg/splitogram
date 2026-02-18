# Phase 1: Tech Stack & Architecture Decisions

Decisions made during planning. Reference this when scaffolding.

---

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Runtime** | Bun | Fast, native TS, workspace support |
| **Backend framework** | Hono | Built for CF Workers, 14KB, runs on Bun/Node/Workers |
| **Bot framework** | grammY | TS-first, modern, plugin ecosystem |
| **ORM** | Drizzle | Typed, lightweight, has D1 adapter |
| **Validation** | Zod | Already integrated with Hono via `@hono/zod-validator` |
| **Frontend** | React 19 + Vite | Mature ecosystem, `@tonconnect/ui-react` bindings exist |
| **TG Mini App SDK** | `@twa-dev/sdk` | Telegram WebApp API access |
| **TON Connect** | `@tonconnect/ui-react` | Official, TON Foundation maintained, React bindings |
| **TON SDK (backend)** | TONAPI REST API (direct `fetch`) | No need for full `@ton/ton` on backend — tx verification is HTTP calls |
| **Styling** | Tailwind CSS | From template, utility-first |

## Deployment: Cloudflare (not GCloud)

**Decision:** Cloudflare over GCloud. Rationale:

| Factor | Cloudflare | GCloud |
|--------|-----------|--------|
| **Cost at MVP** | $0 (free tier) | ~$7-15/mo (no free Postgres) |
| **Cold starts** | ~0ms (V8 isolates) | 300ms-2s (containers) |
| **Database** | D1 (SQLite) — free: 5M reads/day, 100k writes/day, 5GB | Cloud SQL Postgres — no free tier |
| **Sessions/cache** | KV — free tier generous | Memorystore — paid |
| **Static hosting** | Pages — free, global CDN | Cloud Storage — ~free but no CDN |
| **Local dev** | `wrangler dev` — fast, emulates D1/KV locally | `gcloud` CLI — heavy, no local DB emulation |
| **Bot responsiveness** | Instant (no cold start) | 1-2s on cold webhook |

**Architecture:**
```
Cloudflare Pages          Cloudflare Worker              Cloudflare D1 (SQLite)
(frontend static)    →    (API + bot webhook)      →     Cloudflare KV (sessions)
     React + Vite          Hono + grammY + Drizzle        TONAPI (external, REST)
     TON Connect UI
```

**Escape hatch:** If Workers ever limits us (memory, CPU, Node.js compat), same code runs on a $5 Hetzner VPS with Bun + Docker. Hono runs natively on Bun.

**D1 caveat:** D1 is SQLite, not Postgres. Drizzle supports both. Schema differences are minimal for our use case. No JOINs across databases, no stored procedures — we're fine.

**TON SDK in Workers caveat:** `@ton/ton` may have issues in V8 isolates. For Phase 1, backend only needs to call TONAPI REST endpoints for tx verification — plain `fetch()`, no SDK needed. If we later need `@ton/ton` on backend, Workers has `nodejs_compat` flag.

## Template Repo: What to Reuse

**Source:** `/Users/dmitrykozlov/repos/telegram-webapp-cloudflare-template`

This is a battle-tested Cloudflare + Hono + Drizzle + grammY template with the exact same stack. Reuse liberally.

### Copy-paste (minimal changes)

| File(s) | What | Notes |
|---------|------|-------|
| `backend/src/services/telegram-auth.ts` | HMAC-SHA256 initData validation | Battle-tested. Validates signature, checks auth_date age, parses user data via Zod. |
| `backend/src/services/session-manager.ts` | KV-based session management | UUID sessions, TTL (3600s), JSON storage in KV. |
| `backend/src/middleware/auth-middleware.ts` | Session validation middleware | Extracts `Authorization: Bearer` or `X-Session-ID`, validates via SessionManager. |
| `backend/src/middleware/db-middleware.ts` | Drizzle DB injection | Creates Drizzle instance from D1 binding, attaches to Hono context. |
| `backend/src/api/auth.ts` | `POST /api/auth` endpoint | Validates initData, creates session, upserts user, returns session ID. |
| `backend/src/api/health.ts` | `GET /api/health` endpoint | Liveness check. |
| `backend/src/dev/mock-user.ts` | Dev auth bypass | `DEV_AUTH_BYPASS_ENABLED` flag skips TG validation in dev. |
| `backend/src/types/env.ts` | Env bindings interface | `Env { DB, SESSIONS, TELEGRAM_BOT_TOKEN, ... }` |
| `frontend/vite.config.ts` | Vite dev proxy | Proxies `/api`, `/webhook` to `localhost:8787`. |
| `frontend/src/services/api.ts` | API client pattern | Fetch wrapper with session header injection. Adapt for our endpoints. |
| `frontend/src/hooks/use-telegram-back-button.ts` | TG back button hook | Reuse directly. |
| `frontend/src/hooks/use-telegram-main-button.ts` | TG main button hook | Reuse directly. |
| `.github/workflows/*` | CI/CD pipeline | 4-stage: build+test → deploy worker → deploy pages → set webhook. Adapt names/secrets. |
| `scripts/tunnel.sh` | ngrok tunnel for local dev | Reuse directly. |
| `scripts/webhook.sh` | Set TG webhook URL | Reuse directly. |
| `wrangler.toml` | Worker config | Adapt: rename bindings, remove R2, keep D1 + KV + `nodejs_compat`. |

### Adapt (use as reference, rewrite for our domain)

| Source | What to take | What changes |
|--------|-------------|--------------|
| `backend/src/index.ts` | Hono app setup, middleware stack, CORS, error handler | Replace routes with our domain (groups, expenses, balances, settlement) |
| `backend/src/webhook.ts` | grammY bot setup, webhook handler | Replace commands with our bot logic (/start, deep links, notifications) |
| `backend/src/db/schema.ts` | Drizzle schema pattern | Replace tables with our schema (users, groups, expenses, debts) |
| `frontend/src/config.ts` | Config from env vars | Same pattern, our variable names |
| `frontend/src/App.tsx` | React app shell with TG SDK | Add TON Connect provider, our routing |

### Leave behind (not needed for Phase 1)

- R2 bucket / image service — no file uploads
- Telegram Stars payment service — we do TON settlement
- Posts/Comments CRUD — different domain
- Admin middleware/panel — not needed
- Image compression/cropping — Phase 4 at earliest
- `react-easy-crop`, `yet-another-react-lightbox` — not needed

## Playbook Principles (from `work_docs/playbook.md`)

The playbook is Python-focused but these principles apply directly:

### Apply to splitogram

| Principle | How |
|-----------|-----|
| **CLAUDE.md first** | Write CLAUDE.md before any code. Project description, all commands, architecture summary, conventions, what NOT to do. |
| **API versioning** | All routes under `/api/v1`. Template uses `/api` — we add versioning. `POST /api/v1/auth`, `GET /api/v1/groups`, etc. |
| **One config source** | `wrangler.toml` for bindings/vars. Zod schema in `env.ts` to validate at startup. No scattered config. |
| **Consistent error shape** | `{error: "machine_code", detail: "human message"}` on every error. Global Hono `onError` handler. |
| **Input validation at boundary** | Zod schemas on all endpoints via `@hono/zod-validator`. Reject garbage at the gate. |
| **Stateless handlers** | Debt calculation, TON verification — pure functions. No module-level state. |
| **Timeout on every I/O call** | TONAPI calls, bot sends — explicit `AbortSignal.timeout()` on every `fetch`. |
| **No retries within a request** | Fail fast. Exception: bot notification delivery (bounded retry with backoff). |
| **Integration tests over mocks** | Hit real D1 (wrangler local), real bot API. Vitest. |
| **Health endpoints excluded from auth** | `/health` bypasses auth middleware. Already in template. |
| **Structured logging** | JSON logs. Template uses `console.log` — upgrade to structured with request context. |
| **Deploy verification script** | Post-deploy: hit `/health`, verify bot webhook, test auth flow. |

### Don't apply (Python-specific or not relevant for CF Workers)

- `hatchling` / `uv` / `pip-audit` — JS/Bun ecosystem
- `prometheus-client` / `/metrics` endpoint — CF Workers has built-in analytics, not self-hosted Prometheus
- Semaphores / `asyncio.gather` — CF handles concurrency at the isolate level
- Docker multi-stage builds — not deploying containers (Workers)
- Graceful shutdown / drain — Workers are ephemeral, no shutdown hook

## Ledger & Debt Simplification

**No library.** Roll our own. The data model is:

```
expenses: (id, group_id, paid_by, amount, currency, description, created_at)
expense_participants: (expense_id, user_id, share_amount)
settlements: (id, group_id, from_user, to_user, amount, status, tx_hash, created_at)
```

Net balance = `SUM(what I paid for others) - SUM(what others paid for me)` — one SQL query.

Debt simplification algorithm (~30 lines):
1. Compute net balance per person
2. Separate into creditors (positive) and debtors (negative)
3. Greedy match: pair largest creditor with largest debtor, transfer `min(credit, |debt|)`, repeat

Good enough for groups under 50 people. No external dependency needed.

## Repo Structure

```
splitogram/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Hono app, route registration, global error handler
│   │   ├── webhook.ts            # grammY bot handlers (/start, deep links)
│   │   ├── env.ts                # Zod schema for Env bindings
│   │   ├── api/
│   │   │   ├── auth.ts           # POST /api/v1/auth       [from template]
│   │   │   ├── health.ts         # GET /health              [from template]
│   │   │   ├── groups.ts         # Group CRUD + invite
│   │   │   ├── expenses.ts       # Expense CRUD
│   │   │   ├── balances.ts       # Debt graph + balances
│   │   │   └── settlement.ts     # Settle up + verify tx
│   │   ├── middleware/
│   │   │   ├── auth.ts           # Session validation        [from template]
│   │   │   └── db.ts             # Drizzle injection          [from template]
│   │   ├── services/
│   │   │   ├── telegram-auth.ts  # HMAC initData validation  [from template]
│   │   │   ├── session.ts        # KV session management     [from template]
│   │   │   ├── notifications.ts  # Bot notification sender
│   │   │   ├── debt-solver.ts    # Debt simplification algo
│   │   │   └── ton-verify.ts     # TONAPI REST tx verification
│   │   ├── db/
│   │   │   ├── index.ts          # Drizzle factory           [from template]
│   │   │   └── schema.ts         # Our tables
│   │   └── models/               # Zod request/response schemas
│   │       ├── expense.ts
│   │       ├── group.ts
│   │       └── settlement.ts
│   ├── drizzle/migrations/
│   ├── tests/
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx               # TG SDK + TON Connect provider
│   │   ├── config.ts             # [from template]
│   │   ├── services/api.ts       # [adapted from template]
│   │   ├── pages/
│   │   │   ├── Home.tsx
│   │   │   ├── Group.tsx
│   │   │   ├── AddExpense.tsx
│   │   │   └── SettleUp.tsx
│   │   ├── components/
│   │   ├── hooks/                # [TG hooks from template]
│   │   └── types/
│   ├── package.json
│   └── vite.config.ts            # [from template]
├── .github/workflows/            # [from template, adapted]
├── scripts/                      # [tunnel.sh, webhook.sh from template]
├── work_docs/                    # Planning docs (not deployed)
├── wrangler.toml                 # D1 + KV bindings, nodejs_compat
├── CLAUDE.md                     # Write this FIRST
├── package.json                  # Bun workspace root
└── .env.example
```
