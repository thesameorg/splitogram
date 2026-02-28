# Architecture & Tech Decisions

Living document. Updated as architectural decisions are made.

---

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
| TON Connect       | `@tonconnect/ui-react`           | Official, React bindings (deferred to Phase 10)        |
| TON verification  | TONAPI REST API (plain `fetch`)  | No SDK needed on backend (deferred to Phase 10)        |

**Frontend framework/UI library:** Currently plain React + Tailwind. A decision on whether to adopt a component library (Telegram UI kit, shadcn/ui, etc.) is pending — see `work_docs/research/frontend-framework.md`.

---

## Deployment

```
Cloudflare Pages          Cloudflare Worker              Cloudflare D1 (SQLite)
(frontend static)    →    (API + bot webhook)      →     Cloudflare R2 (images, Phase 6)
React + Vite               Hono + grammY + Drizzle        TONAPI (external REST, Phase 10)
```

**Why Cloudflare over GCloud:** $0 at MVP (free D1, R2, Pages), ~0ms cold starts (V8 isolates), `wrangler dev` for fast local dev. Escape hatch: same Hono code runs on a $5 VPS with Bun + Docker.

**D1 caveat:** SQLite, not Postgres. Drizzle supports both. No cross-DB joins or stored procedures — fine for our use case.

---

## Authentication: Stateless HMAC (decided Phase 3)

**Decision:** Remove KV sessions. Auth is stateless HMAC verification per request.

**How it works:** Telegram's `initData` is HMAC-SHA256 signed by the bot token. The backend verifies the signature on every API request — zero external calls, no KV, no session state.

**Why:** KV sessions added latency (network round-trip on every request), a failure mode (KV down = everyone logged out), and complexity — all for zero benefit. Telegram Mini Apps don't have "logout." The signed `initData` is the session.

**What was removed:** KV binding from `env.ts`, session middleware, session service, KV namespace from wrangler config.

**Previous approach (Phases 1-2):** `POST /api/v1/auth` validated initData, created a KV session (1h TTL), returned a session ID. All requests sent `Authorization: Bearer {sessionId}`. Auth middleware hit KV on every request to validate.

---

## Navigation: 3-Tab Bottom Nav (decided Phase 3)

**Tabs:** Groups | Activity | Account

- **Groups** — home screen, list of user's groups with balances
- **Activity** — cross-group activity feed (all groups the user belongs to), with pagination. Empty state until Phase 7 populates it.
- **Account** — profile (display name, Telegram avatar from `initData`), theme/language selectors (wired up in Phase 5)

---

## Data Model

- **users**: telegram_id, username, display_name, wallet_address, bot_started
- **groups**: name, invite_code, is_pair, currency (default 'USD'), created_by
- **group_members**: group_id, user_id, role (admin/member), muted
- **expenses**: group_id, paid_by, amount (micro-units integer), description
- **expense_participants**: expense_id, user_id, share_amount
- **settlements**: group_id, from_user, to_user, amount, status (open/payment_pending/settled_onchain/settled_external), tx_hash, comment, settled_by

Amounts stored as integers in micro-units (1 unit = 1,000,000). Currency is per-group. No floating point.

---

## Debt Simplification

No library. ~30-line greedy algorithm in `services/debt-solver.ts`:

1. Compute net balance per person (one SQL query)
2. Separate into creditors (positive) and debtors (negative)
3. Greedy match: pair largest creditor with largest debtor, transfer `min(credit, |debt|)`, repeat

Good enough for groups under 50 people. Tested with 6 cases.

---

## Currency Support (Phase 2)

15 currencies with correct symbols and decimal handling. Shared `utils/currencies.ts` + `utils/format.ts` in both backend and frontend (identical files). Amounts stored as micro-units (1 unit = 1,000,000) regardless of currency. Zero-decimal currencies (VND, JPY, IDR) display without decimals but use the same micro-unit storage.

Full currency list with search to be added in Phase 4 — see `work_docs/research/exchange-rates.md`.

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

| Migration | What                                      | Phase |
| --------- | ----------------------------------------- | ----- |
| 0000      | Initial schema                            | 1     |
| 0001      | Settlement comment + settledBy columns    | 2     |
| 0002      | Group currency column                     | 2     |
| 0003      | users.botStarted + group_members.muted    | 2     |

---

## Pending Research & Decisions

Each has a dedicated file in `work_docs/research/`:

| Topic                          | Phase | File                          |
| ------------------------------ | ----- | ----------------------------- |
| Frontend framework / UI lib    | 3     | `frontend-framework.md`       |
| Balance integrity rules        | 4     | `balance-integrity.md`        |
| Themes & preference persistence| 5     | `themes-and-persistence.md`   |
| i18n approach                  | 5     | `i18n-approach.md`            |
| Image storage (R2)             | 6     | `image-storage-r2.md`         |
| Exchange rates                 | 7     | `exchange-rates.md`           |
| TON Connect & crypto           | 10    | `ton-connect-crypto.md`       |
| Growth & virality              | 9     | `growth-virality.md`          |
| AI & monetization              | 11    | `ai-monetization.md`          |
