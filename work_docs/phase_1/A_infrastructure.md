# A. Project Setup & Infrastructure

Do these first. Everything else depends on this.

**Stack:** Bun + Hono + Drizzle + grammY + Cloudflare (Workers + Pages + D1 + KV)
**Template:** `/Users/dmitrykozlov/repos/telegram-webapp-cloudflare-template` — reuse heavily (see `00_tech_decisions.md`)

---

## A1. Repository & Project Structure

Scaffold from template repo. Bun workspaces with `backend/` and `frontend/` split.

- Copy template structure, strip domain-specific code (posts, comments, images, payments)
- Switch package manager from npm to Bun (`bun install`, `bun run`)
- Root `package.json` with Bun workspace config
- Backend: Hono + Drizzle + grammY (already in template)
- Frontend: React 19 + Vite + Tailwind (already in template)
- Add to frontend: `@tonconnect/ui-react`, `@ton/ton` (for tx construction)
- Linter: ESLint (from template), formatter: Prettier (from template)
- `.env.example` with all required vars
- **Write CLAUDE.md first** (playbook principle — project description, all commands, architecture summary, conventions)

**From template:** Root `package.json`, `tsconfig.json`, `.gitignore`, ESLint configs, `scripts/tunnel.sh`, `scripts/webhook.sh`

**Output:** `git clone` → `bun install` → `bun run dev` works for both backend and frontend.

---

## A2. Database & KV Setup

**Database:** Cloudflare D1 (SQLite via Drizzle ORM)
**Sessions:** Cloudflare KV

- Copy `wrangler.toml` from template, adapt:
  - Rename D1 database binding
  - Keep KV namespace for sessions (binding: `SESSIONS`)
  - Remove R2 bucket (no images in Phase 1)
  - Keep `nodejs_compat` flag
  - Set `PAGES_URL` var for CORS
- Copy `backend/src/db/index.ts` from template (Drizzle factory for D1)
- Write initial schema in `backend/src/db/schema.ts` (see B_data_model.md for tables)
- Generate first migration: `bun run db:generate`
- Verify D1 works locally: `wrangler dev --local` + test query

**From template:** `wrangler.toml` structure, `db/index.ts` factory, migration workflow (`drizzle-kit generate:sqlite`)

**Output:** Empty D1 database running locally via wrangler, migrations tooling working.

---

## A3. Backend Skeleton

Copy the Hono app skeleton from template, strip domain code, add our structure.

- Copy from template:
  - `backend/src/index.ts` — Hono app, middleware stack, CORS, `prettyJSON()`, global error handler
  - `backend/src/middleware/auth.ts` — session validation
  - `backend/src/middleware/db.ts` — Drizzle injection into context
  - `backend/src/services/telegram-auth.ts` — HMAC-SHA256 initData validation (battle-tested)
  - `backend/src/services/session-manager.ts` — KV session CRUD with TTL
  - `backend/src/api/auth.ts` — `POST /api/auth` endpoint
  - `backend/src/api/health.ts` — `GET /health` endpoint
  - `backend/src/dev/mock-user.ts` — dev auth bypass
  - `backend/src/types/env.ts` — Env bindings interface
- Adapt:
  - Add `/v1` prefix to all API routes (playbook principle: API versioning)
  - Add Zod schema for Env validation at startup (playbook: fail at startup, not runtime)
  - Consistent error shape: `{error: "machine_code", detail: "human message"}`
  - Structured logging (upgrade template's `console.log`)
  - Add TONAPI base URL to env config
  - Stub route files: `groups.ts`, `expenses.ts`, `balances.ts`, `settlement.ts`

**Output:** `GET /health` returns 200. `POST /v1/auth` validates TG initData and returns session. Auth middleware rejects unsigned requests. Dev bypass works.

---

## A4. Deployment Pipeline

Copy GitHub Actions from template, adapt for splitogram.

- Copy `.github/workflows/` from template:
  - `1-build-test.yml` — lint + typecheck + test (both frontend and backend)
  - `2-deploy-worker.yml` — D1 migrations + deploy Worker + test endpoints
  - `3-deploy-pages.yml` — build frontend + deploy to Pages + test
  - `4-setup-webhook.yml` — register TG bot webhook URL
  - `deploy-pipeline.yml` — orchestrates all 4 stages
- Adapt:
  - Update project/database names
  - Update secrets (add `TONAPI_KEY` if needed)
  - Switch npm commands to Bun equivalents
  - Frontend build injects `VITE_WORKER_URL`, `VITE_TELEGRAM_BOT_USERNAME`
- Register bot with @BotFather, get token
- Create D1 database and KV namespace in Cloudflare dashboard
- Set GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TELEGRAM_BOT_TOKEN`

**From template:** Entire `.github/workflows/` directory, `scripts/webhook.sh`

**Output:** Push to main → deployed and accessible via HTTPS within minutes. Bot webhook set.
