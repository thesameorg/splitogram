# Technical Debt — Fix Before Building Phase 2 Features

Priority: **HIGH**. These issues will compound as more code is added on top.

---

## T1. N+1 query bomb on home screen (`GET /api/v1/groups`)

**Problem:** For each group, runs `computeUserNetBalance` which fires 4 SQL queries + 1 member count. 10 groups = 51 queries. Each D1 query is an HTTP round-trip. This is the home screen — the first thing users see.

**Files:** `backend/src/api/groups.ts:113-133`

**Fix:** Replace per-group queries with aggregated SQL. Reduce N×5 queries to ~3 total regardless of group count.

---

## T2. Two diverging balance implementations

**Problem:** `computeGroupBalances` (debt graph) and `computeUserNetBalance` (group list) are separate implementations of the same math. They will drift. When settlement statuses change, one gets updated and the other doesn't.

**Files:** `backend/src/api/balances.ts:152`, `backend/src/api/groups.ts:319`

**Fix:** Delete `computeUserNetBalance`. Use `computeGroupBalances` everywhere. One function = one source of truth.

---

## T3. `db: any` in all helper functions

**Problem:** `computeUserNetBalance`, `computeGroupBalances`, `sendSettlementNotification` all take `db: any`. Schema changes and Drizzle upgrades won't surface type errors until runtime.

**Files:** `backend/src/api/groups.ts:319`, `backend/src/api/balances.ts:152`, `backend/src/api/settlements.ts:496`

**Fix:** Import and use `Database` type from `backend/src/db/index.ts`.

---

## T4. `formatAmount` duplicated in 4 places

**Problem:** Same `$${(microUsdt / 1_000_000).toFixed(2)}` formula in `Home.tsx`, `Group.tsx`, `SettleUp.tsx`, `notifications.ts`. Phase 2 currency support will make this worse.

**Fix:**
- Frontend: create `frontend/src/utils/format.ts`, import everywhere
- Backend: create `backend/src/utils/format.ts`
- Must happen before currency work starts

---

## T5. New `Bot` instance per notification recipient

**Problem:** `sendMessage` creates `new Bot(ctx.botToken)` per recipient. 5 participants = 5 Bot instances. Unnecessary allocation.

**Files:** `backend/src/services/notifications.ts:24`

**Fix:** Construct Bot once per notification batch in the caller, pass it to `sendMessage`.

---

## T6. Pagination offset not clamped

**Problem:** `offset` param accepts negative values. `parseInt('-5', 10)` → SQLite silently returns unexpected results.

**Files:** `backend/src/api/expenses.ts:202`

**Fix:** `const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10));`

---

## T7. Dead code cleanup

- `refreshSession` in `session-manager.ts:48-62` — implemented, never called. Delete it.
- `SessionManager.create()` static factory in `session-manager.ts:64-66` — never used, constructor is used directly. Delete it.
- Duplicate unique index on `groups.invite_code` in migration — remove `.unique()` from column def, keep only `uniqueIndex()` in table callback.

---

## T8. Observability: log sampling at 10%

**Problem:** `head_sampling_rate = 0.1` in `wrangler.toml:8`. At Phase 2 scale, 90% of errors are invisible.

**Fix:** Set to `1.0` until traffic justifies reducing.

---

## T9. On-chain verification is a stub — security gate for Phase 3

**Problem:** `verifyTransaction` at `settlements.ts:549` only checks that a tx hash exists on-chain. Does not verify sender, recipient, amount, Jetton contract, or memo. Anyone can submit any legit tx hash.

**Files:** `backend/src/api/settlements.ts:549-554`

**Fix:** Add hard comment marking this as security gate. Do NOT enable Phase 3 crypto until full Jetton transfer verification is implemented (sender wallet, recipient wallet, amount, contract address, memo).
