# Splitogram — Project Status

Last updated: 2026-02-27

## Phase 1: Testnet Prototype — ~95% complete

### What's Built

#### A. Infrastructure & CI/CD — DONE

- Monorepo scaffolded from template (Bun workspaces: `backend/`, `frontend/`)
- Cloudflare Worker (backend) + Pages (frontend) + D1 (SQLite) + KV (sessions)
- Drizzle ORM with migration pipeline (`db:generate`, `db:migrate:local`)
- 5-stage GitHub Actions pipeline: build/test → deploy worker → deploy pages → setup webhook
- Health endpoint, dev auth bypass, ngrok tunnel scripts
- Docs: CLAUDE.md (full architecture + commands), README.md (quick start + CI/CD setup)

#### B. Data Model & API — DONE (B5 deferred)

All tables implemented in `backend/src/db/schema.ts`:

- `users` — telegram_id, username, display_name, wallet_address
- `groups` — name, invite_code (unique 8-char), is_pair, created_by
- `groupMembers` — group_id, user_id, role (admin/member)
- `expenses` — group_id, paid_by, amount (micro-USDT integer), description
- `expenseParticipants` — expense_id, user_id, share_amount
- `settlements` — group_id, from/to user, amount, status, tx_hash

All API routes implemented under `/api/v1`:

| Method | Endpoint                         | What it does                                       |
| ------ | -------------------------------- | -------------------------------------------------- |
| POST   | `/auth`                          | TG initData validation → KV session                |
| POST   | `/groups`                        | Create group (auto-add creator as admin)           |
| GET    | `/groups`                        | List user's groups with member count + net balance |
| GET    | `/groups/:id`                    | Group detail (members, balances)                   |
| GET    | `/groups/join/:code`             | Resolve invite code (public, no auth)              |
| POST   | `/groups/:id/join`               | Join group                                         |
| POST   | `/groups/:id/expenses`           | Add expense with equal splits                      |
| GET    | `/groups/:id/expenses`           | List expenses (paginated)                          |
| GET    | `/groups/:id/balances`           | Optimized debt graph                               |
| GET    | `/groups/:id/balances/me`        | Current user's debts                               |
| POST   | `/groups/:id/settlements`        | Create settlement on demand (idempotent)           |
| GET    | `/settlements/:id`               | Settlement detail                                  |
| GET    | `/settlements/:id/tx`            | USDT transfer payload for TON Connect              |
| POST   | `/settlements/:id/verify`        | Verify tx on TONAPI                                |
| POST   | `/settlements/:id/mark-external` | Creditor marks settled externally                  |
| PUT    | `/users/me/wallet`               | Store TON wallet address                           |
| DELETE | `/users/me/wallet`               | Clear wallet address                               |

Debt solver: greedy algorithm in `services/debt-solver.ts` (tested, 5 cases).

**B5 (1-on-1 direct expenses) — deferred.** Use pair groups manually for now.

#### C. Bot & Notifications — DONE

- grammY webhook handler at `POST /webhook`
- `/start` → welcome message + "Open Splitogram" button
- `/start join_{inviteCode}` → auto-join group, upsert user, confirmation + "Open Group" button
- Notification service with `expenseCreated()`, `settlementCompleted()`, `memberJoined()`
- Notifications wired into API handlers via fire-and-forget `executionCtx.waitUntil()`:
  - `POST /groups/:id/expenses` → notifies participants (except payer)
  - `POST /settlements/:id/verify` (on success) → notifies debtor + creditor
  - `POST /settlements/:id/mark-external` → notifies debtor + creditor
  - `POST /groups/:id/join` → notifies existing group members
- Inline buttons in notifications include deep links to specific groups
- Frontend deep link routing: reads `startParam` from TG WebApp, navigates to correct view

#### D. Settlement Flow — DONE (basic verification)

- Settlement created on demand from debt graph (idempotent)
- Backend constructs Jetton transfer payload (recipient, amount, memo)
- Frontend sends tx via `tonConnectUI.sendTransaction()`
- Frontend sends BOC to verify endpoint, polls every 3s for 60s
- TONAPI verification: basic (tx exists + confirmed)
- Mark externally: creditor-only, no on-chain check
- TON Connect integration with testnet manifest

**Note:** Verification is basic — checks tx exists, doesn't fully verify sender/recipient/amount/memo. Acceptable for testnet Phase 1. Full verification planned for Phase 2 (mainnet).

#### E. Frontend — DONE (E6 partial)

4 pages implemented:

- **Home** — group list, net balances (color-coded), create group modal, overall balance summary
- **Group** — expenses/balances tabs, invite sharing via Telegram, settle up buttons
- **AddExpense** — form with amount, description, paid-by, participant selector, live per-person calc
- **SettleUp** — wallet connect, tx approval, polling, success/error states, mark-external option

Hooks: `useAuth`, `useTelegramBackButton`, `useTelegramMainButton`
API client: full coverage of all backend endpoints in `services/api.ts`

**E6 (dedicated wallet screen) — not implemented.** Wallet connect/disconnect works inline during settlement. No standalone wallet management page.

### Tests

- `backend/tests/debt-solver.test.ts` — 5 test cases for debt simplification algorithm
- Frontend: no tests yet (Vitest configured but no test files)

### Documentation

- `README.md` — stack, architecture, quick start, CI/CD setup, GitHub secrets
- `CLAUDE.md` — full architecture, all commands, local dev setup, conventions, code style

---

### What's Left to Complete Phase 1

#### End-to-end testing with real users (F1-F4)

All code is implemented. The remaining work is manual testing on testnet with 3+ people:

1. Create group → share invite → others join via bot
2. Add expense → participants get notification → tap notification → lands on correct group
3. Settle up → connect wallet → approve testnet USDT tx → on-chain verification
4. Mark externally for no-wallet user
5. Verify all deep links work (bot `?start=` + mini app `?startapp=`)

---

### Phase 1 Definition of Done

- [x] User creates group via mini app
- [x] User invites others via link (bot deep link `?start=join_{code}`)
- [x] Invitee taps link → bot auto-joins them → confirmation message
- [x] User adds expense, selects who's involved
- [x] Involved members get bot notification
- [x] Debtor sees balance, taps "Settle up"
- [x] Testnet USDT transfer constructed and approved via TON Connect
- [x] On-chain verification marks debt as settled
- [x] Group gets settlement notification
- [x] Non-wallet user can mark debt as "settled externally"
- [x] Tapping notification opens correct screen (deep link routing)
- [ ] **Full cycle tested with 3+ people on testnet** ← manual testing
- [x] CI/CD pipeline deploys and passes health checks

---

## Phases 2–9: Not Started

| Phase | Name               | Key Milestone                                    | Depends On |
| ----- | ------------------ | ------------------------------------------------ | ---------- |
| 2     | Mainnet Launch     | First real USDT settlement                       | Phase 1    |
| 3     | Retention & Trust  | 30-day retention baseline                        | Phase 2    |
| 4     | Advanced Splitting | Percentage/ratio splits, categories, attachments | Phase 2    |
| 5     | Growth & Virality  | Viral coefficient measured                       | Phase 3    |
| 6     | AI Features        | Receipt scanning                                 | Phase 4    |
| 7     | Multi-Currency     | International groups                             | Phase 4    |
| 8     | Monetization       | Premium subscription ($3-5/mo)                   | Phase 6, 7 |
| 9     | Platform Expansion | Recurring expenses, analytics, export            | Phase 8    |

See `phases.md` for full deliverables and scope boundaries per phase.

---

## Deferred Items (tracked in `phase_1/later.md`)

- **Race condition on concurrent settlements** — use KV distributed lock. Not an issue with single tester.
- **Bot notification for users who haven't /started** — catch 403, track `bot_started` flag. Handle in Phase 2.
- **Invite code collision** — DB unique constraint catches it. Add retry-on-collision at scale.

---

## Reference Docs

| Doc                             | Purpose                                                 |
| ------------------------------- | ------------------------------------------------------- |
| `CLAUDE.md`                     | Architecture, commands, conventions, local dev          |
| `README.md`                     | Quick start, CI/CD, GitHub config                       |
| `work_docs/idea.md`             | Business overview, competitive landscape, revenue model |
| `work_docs/phases.md`           | 9-phase roadmap with scope boundaries                   |
| `work_docs/phase_1/later.md`    | Deferred decisions from code review                     |
| `work_docs/additional-ideas.md` | Future: multiple wallets per user                       |
