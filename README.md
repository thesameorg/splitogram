# Splitogram

Telegram Mini App for splitting group expenses with on-chain USDT settlement on TON blockchain. Splitwise meets Telegram Wallet.

## Stack

| Layer    | Tech                                                                 |
| -------- | -------------------------------------------------------------------- |
| Runtime  | Bun                                                                  |
| Backend  | Hono (Cloudflare Worker) + grammY + Drizzle ORM + Zod               |
| Frontend | React 19 + Vite (Cloudflare Pages) + Tailwind + TON Connect         |
| Database | Cloudflare D1 (SQLite) + KV (sessions)                              |
| CI/CD    | GitHub Actions → Cloudflare                                          |

## Architecture

```
Cloudflare Pages          Cloudflare Worker              Cloudflare D1 (SQLite)
(frontend static)    →    (API + bot webhook)      →     Cloudflare KV (sessions)
React + Vite               Hono + grammY + Drizzle        TONAPI (external REST)
TON Connect UI
```

## Development

### Prerequisites

- [Bun](https://bun.sh), [ngrok](https://ngrok.com), jq
- `.env` with `TELEGRAM_BOT_TOKEN`, `VITE_TELEGRAM_BOT_USERNAME`
- `.dev.vars` with wrangler secrets (see CLAUDE.md)

### Quick start

```bash
bun install
bun run db:migrate:local       # apply migrations to local D1

# Terminal 1: backend
bun run dev:backend            # wrangler dev on :8787

# Terminal 2: frontend
bun run dev:frontend           # vite dev on :5173

# Terminal 3: tunnel + webhook (for bot testing)
bun run tunnel:start           # ngrok → :5173
bun run webhook:set            # point bot to tunnel
```

### Commands

```bash
bun run dev                    # backend + frontend in parallel
bun run test                   # all tests
bun run test:backend           # backend tests only
bun run test:frontend          # frontend tests only
bun run lint                   # lint all
bun run typecheck              # typecheck all
bun run db:generate            # generate migration from schema changes
bun run db:migrate:local       # apply migrations locally
bun run deploy                 # manual deploy (CI handles this)
```

## CI/CD

Push to `main` triggers the full deploy pipeline:

1. **Build & Test** — lint, typecheck, tests (backend + frontend in parallel)
2. **Deploy Worker** — D1 migrations, secrets, wrangler deploy, health check
3. **Deploy Pages** — build frontend, deploy to Cloudflare Pages
4. **Setup Webhook** — configure Telegram bot webhook to worker URL

### Required GitHub configuration

**Secrets:**
- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with Workers/Pages/D1 permissions
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID
- `TELEGRAM_BOT_TOKEN` — Telegram bot token from @BotFather

**Variables:**
- `WORKER_URL` — deployed worker URL (e.g. `https://splitogram.dksg87.workers.dev`)
- `PAGES_URL` — deployed pages URL (e.g. `https://splitogram.pages.dev`)
- `PAGES_PROJECT_NAME` — Cloudflare Pages project name
- `TELEGRAM_BOT_USERNAME` — bot username without @

## Project status

Phase 1 (Testnet Prototype) — in progress. See [work_docs/phases.md](work_docs/phases.md) for the full roadmap.

## Docs

- [CLAUDE.md](CLAUDE.md) — full architecture, conventions, and local dev setup
- [work_docs/idea.md](work_docs/idea.md) — business overview and competitive landscape
- [work_docs/phases.md](work_docs/phases.md) — 9-phase roadmap
- [work_docs/phase_1/](work_docs/phase_1/) — Phase 1 task breakdown
