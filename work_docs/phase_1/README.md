# Phase 1: Testnet Prototype — Task Breakdown

Tasks are grouped by domain and roughly ordered by dependency. Tasks within the same group can often be parallelized.

## Key References

- **Tech decisions & architecture:** [00_tech_decisions.md](./00_tech_decisions.md) — stack, deployment, template reuse, playbook principles
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

| #   | Group                                                   | Tasks         | Status                            | Notes                                                                                |
| --- | ------------------------------------------------------- | ------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| 0   | [Tech Decisions](./00_tech_decisions.md)                | Reference doc | **Done**                          | Stack, architecture, template reuse plan                                             |
| A   | [Project Setup & Infrastructure](./A_infrastructure.md) | 4 tasks       | **Done** (A1-A3), A4 pending      | Scaffolded from template. Monorepo, backend, frontend, wrangler.toml. CI/CD pending. |
| B   | [Data Model & Core Logic](./B_data_model.md)            | 5 tasks       | **B1 done, B2-B5 not started**    | Schema all defined. Auth + sessions implemented. API route handlers not written yet. |
| C   | [Telegram Bot & Notifications](./C_bot.md)              | 4 tasks       | **C1 done, C2-C4 not started**    | Bot /start + join deep link working. Notification service not written.               |
| D   | [TON Wallet & Settlement](./D_settlement.md)            | 4 tasks       | **D1 shell only, D2-D4 not started** | TonConnectUIProvider wraps app. No settle flow, no tx construction, no verification. |
| E   | [Mini App Frontend](./E_frontend.md)                    | 6 tasks       | **E1 shell only, E2-E6 not started** | App loads with TG SDK init. No router, no pages, no components, no hooks.            |
| F   | [Integration & Polish](./F_integration.md)              | 4 tasks       | **Not started**                   | Wire everything together                                                             |
| -   | [Deferred Decisions](./later.md)                        | Reference doc | -                                 | Decisions from code-tightener review, deferred items                                 |

## Dependency Graph

```
A (Infrastructure) — heavy template reuse
├── B (Data Model) — new schema, auth from template
│   ├── C (Bot) — webhook pattern from template
│   ├── D (Settlement) — new code, TONAPI + TON Connect
│   └── E (Frontend) — shell from template, TON Connect new
│       └── F (Integration & Polish)
```

A must complete first. B is next. Then C, D, E can proceed in parallel. F is last.

## How to Start

1. **Read `00_tech_decisions.md`** — understand the stack and what comes from the template
2. **Write CLAUDE.md** (playbook principle: write this before any code)
3. **A1-A4:** Scaffold from template, strip irrelevant code, add our structure
4. **B1:** Auth is copy-paste from template + our user schema
5. **B2-B5:** New domain code (groups, expenses, debt solver)
6. **C, D, E in parallel:** Bot, settlement, frontend
7. **F:** Wire it all together, test end-to-end

## Definition of Done (Phase 1)

- [x] CLAUDE.md written with all commands and architecture
- [ ] User creates group via mini app
- [ ] User invites others via link
- [ ] Invitee gets bot notification, taps inline button, joins group
- [ ] User adds expense, selects who's involved
- [ ] Involved members get bot notification
- [ ] Debtor sees balance, taps "Settle up"
- [ ] Testnet USDT transfer constructed and approved via TON Connect
- [ ] On-chain verification marks debt as settled
- [ ] Group gets settlement notification via bot
- [ ] Non-wallet user can mark debt as "settled externally"
- [ ] Full cycle works on testnet with 3+ people
- [ ] Deploy verification script passes on production URL
