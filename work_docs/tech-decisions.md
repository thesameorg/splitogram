# Tech Stack & Architecture Decisions

Made during Phase 1 planning, updated after Phase 2.

## Stack

| Layer             | Choice                           | Why                                                    |
| ----------------- | -------------------------------- | ------------------------------------------------------ |
| Runtime           | Bun                              | Fast, native TS, workspace support                     |
| Backend           | Hono (CF Worker)                 | Built for Workers, 14KB, runs on Bun/Node/Workers      |
| Bot               | grammY                           | TS-first, modern, plugin ecosystem                     |
| ORM               | Drizzle                          | Typed, lightweight, D1 adapter                         |
| Validation        | Zod + `@hono/zod-validator`      | Integrated with Hono                                   |
| Frontend          | React 19 + Vite + Tailwind       | Mature ecosystem, TON Connect React bindings           |
| TG Mini App SDK   | `@twa-dev/sdk`                   | Telegram WebApp API access                             |
| TON Connect       | `@tonconnect/ui-react`           | Official, React bindings (deferred to Phase 3)         |
| TON verification  | TONAPI REST API (plain `fetch`)  | No SDK needed on backend (deferred to Phase 3)         |

## Deployment: Cloudflare

```
Cloudflare Pages          Cloudflare Worker              Cloudflare D1 (SQLite)
(frontend static)    →    (API + bot webhook)      →     Cloudflare KV (sessions)
React + Vite               Hono + grammY + Drizzle        TONAPI (external, REST)
```

**Why Cloudflare over GCloud:** $0 at MVP (free D1, KV, Pages), ~0ms cold starts (V8 isolates), `wrangler dev` for fast local dev. Escape hatch: same Hono code runs on a $5 VPS with Bun + Docker.

**D1 caveat:** SQLite, not Postgres. Drizzle supports both. No cross-DB joins or stored procedures — fine for our use case.

## Key Engineering Principles

- **CLAUDE.md first** — project description, commands, architecture, conventions before code
- **API versioning** — all routes under `/api/v1`
- **Consistent error shape** — `{error: "machine_code", detail: "human message"}`
- **Zod at the boundary** — validate all inputs via `@hono/zod-validator`
- **Timeout on every I/O** — `AbortSignal.timeout()` on TONAPI, bot API calls
- **Stateless handlers** — debt calculation, verification are pure functions
- **Integration tests over mocks** — hit real D1 (wrangler local), real bot API
- **Fire-and-forget notifications** — `executionCtx.waitUntil()` for bot sends

## Debt Simplification

No library. ~30-line greedy algorithm in `services/debt-solver.ts`:

1. Compute net balance per person (one SQL query)
2. Separate into creditors (positive) and debtors (negative)
3. Greedy match: pair largest creditor with largest debtor, transfer `min(credit, |debt|)`, repeat

Good enough for groups under 50 people. Tested with 6 cases.

## Currency Support (Phase 2)

15 currencies with correct symbols and decimal handling. Shared `utils/currencies.ts` + `utils/format.ts` in both backend and frontend (identical files). Amounts stored as micro-units (1 unit = 1,000,000) regardless of currency. Zero-decimal currencies (VND, JPY, IDR) display without decimals but use the same micro-unit storage.

## Template Origin

Scaffolded from `/Users/dmitrykozlov/repos/telegram-webapp-cloudflare-template`. Auth, session management, middleware, CI/CD pipeline, TG hooks, API client pattern all came from template. Domain code (groups, expenses, balances, settlement) is original.
