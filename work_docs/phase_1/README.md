# Phase 1: Testnet Prototype — Task Breakdown

Tasks are grouped by domain and roughly ordered by dependency. Tasks within the same group can often be parallelized.

## Key References

- **Tech decisions & architecture:** [done/00_tech_decisions.md](./done/00_tech_decisions.md) — stack, deployment, template reuse, playbook principles
- **Template repo:** `/Users/dmitrykozlov/repos/telegram-webapp-cloudflare-template` — battle-tested CF + Hono + Drizzle + grammY template
- **Engineering playbook:** `work_docs/playbook.md` — principles that apply (API versioning, error shapes, testing, etc.)
- **Product spec:** `work_docs/idea.md` — full business overview and decisions
- **Phases roadmap:** `work_docs/phases.md` — all phases with scope boundaries

## Stack Summary

| Layer      | Tech                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| Runtime    | Bun                                                                    |
| Backend    | Hono (CF Worker) + grammY + Drizzle + Zod                              |
| Frontend   | React 19 + Vite (CF Pages) + Tailwind + TON Connect                    |
| Database   | Cloudflare D1 (SQLite)                                                 |
| Sessions   | Cloudflare KV                                                          |
| Blockchain | TONAPI REST (backend) + `@ton/ton` + `@tonconnect/ui-react` (frontend) |
| CI/CD      | GitHub Actions → Cloudflare (from template)                            |

## Task Groups

| #   | Group                                                       | Tasks         | Status                            | Notes                                                                                |
| --- | ----------------------------------------------------------- | ------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| 0   | [Tech Decisions](./done/00_tech_decisions.md)               | Reference doc | **Done**                          | Stack, architecture, template reuse plan                                             |
| A   | [Project Setup & Infrastructure](./done/A_infrastructure.md)| 4 tasks       | **Done** (A1-A3), A4 pending      | Scaffolded from template. Monorepo, backend, frontend, wrangler.toml. CI/CD pending. |
| B   | [Data Model & Core Logic](./done/B_data_model.md)           | 5 tasks       | **Done** (B1-B4). B5 deferred.    | All API routes implemented: groups, expenses, balances, settlements.                 |
| C   | [Telegram Bot & Notifications](./C_bot.md)                  | 4 tasks       | **C1-C2 done, C3-C4 partial**     | Bot + join deep link + notification service done. Deep link routing & wiring pending. |
| D   | [TON Wallet & Settlement](./D_settlement.md)                | 4 tasks       | **D1-D4 done** (basic)            | Settle flow, tx params, TONAPI verify, mark-external all implemented.                |
| E   | [Mini App Frontend](./done/E_frontend.md)                   | 6 tasks       | **Done** (E1-E5). E6 partial.     | Router, all pages (Home, Group, AddExpense, SettleUp), hooks, API client.            |
| F   | [Integration & Polish](./F_integration.md)                  | 4 tasks       | **Not started**                   | Wire notifications into API handlers, e2e testing, deploy.                           |
| -   | [Deferred Decisions](./later.md)                            | Reference doc | -                                 | Decisions from code-tightener review, deferred items                                 |

## Dependency Graph

```
A (Infrastructure) — heavy template reuse  ✅
├── B (Data Model) — new schema, auth from template  ✅
│   ├── C (Bot) — webhook pattern from template  ⚡ partial
│   ├── D (Settlement) — new code, TONAPI + TON Connect  ✅
│   └── E (Frontend) — shell from template, TON Connect new  ✅
│       └── F (Integration & Polish)  ⏳ next
```

## What's Left

1. **Wire notifications into API handlers** — the notification service exists but isn't called from expense/settlement/join handlers yet
2. **Deep link routing in frontend** — read `startParam` on app mount, navigate to correct view
3. **CI/CD pipeline (A4)** — GitHub Actions workflows not yet set up
4. **B5 (1-on-1 direct expenses)** — deferred, use pair groups manually for now
5. **E6 (dedicated wallet screen)** — wallet connection works in settle flow, no standalone screen yet
6. **F1-F4** — end-to-end testing, error states, deploy verification

## Definition of Done (Phase 1)

- [x] CLAUDE.md written with all commands and architecture
- [x] User creates group via mini app
- [x] User invites others via link (invite button + bot deep link)
- [x] Invitee gets bot notification, taps inline button, joins group (bot /start join_ handler)
- [x] User adds expense, selects who's involved
- [ ] Involved members get bot notification (service exists, not wired to handlers)
- [x] Debtor sees balance, taps "Settle up"
- [x] Testnet USDT transfer constructed and approved via TON Connect
- [x] On-chain verification marks debt as settled (basic TONAPI check)
- [ ] Group gets settlement notification via bot (service exists, not wired)
- [x] Non-wallet user can mark debt as "settled externally"
- [ ] Full cycle works on testnet with 3+ people (needs deploy + multi-user test)
- [ ] Deploy verification script passes on production URL (needs A4 CI/CD)
