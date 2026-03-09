# Code Review — Architectural & Logic Concerns

Full codebase review performed 2026-03-09. Issues categorized by severity.

---

## Critical

### 1. GET endpoint mutates database (`settlements.ts`)

**File:** `backend/src/api/settlements.ts` — GET `/settlements/:id`

The GET handler for fetching a settlement performs lazy on-chain verification: if status is `payment_pending`, it calls TONAPI, and on success **updates the settlement status to `settled_onchain` in D1**. A GET request should be idempotent and side-effect-free. This violates HTTP semantics and could cause issues with caching, retries, and CDN behavior.

**Fix:** Move verification to a dedicated `POST /settlements/:id/verify` endpoint (or a separate background polling mechanism). The frontend already has a polling loop — make it POST instead of GET.

---

### 2. On-chain verification is spoofable (`settlements.ts`)

**File:** `backend/src/api/settlements.ts` — `verifySettlementOnChain()`

The verification logic queries TONAPI for recent events on the settlement contract and checks if any Jetton transfer matches the expected amount. However:
- It only checks the **amount** — not the sender or recipient addresses
- Any user sending the right amount to the contract could satisfy the check
- The `txHash` stored is whatever event matched first, not necessarily from the actual payer

**Fix:** Verify the full trace: sender must be the debtor's wallet, recipient (forward_payload) must be the creditor's wallet, and amount must match within a tolerance. Consider storing the expected BOC hash and matching against it.

---

### 3. Non-atomic placeholder claim (`groups.ts`)

**File:** `backend/src/api/groups.ts` — `POST /groups/:id/claim-placeholder`

The claim flow performs 5+ sequential D1 writes (update expenses.paid_by, expense_participants, settlements from/to, activity_log, delete dummy user, update group_members). These are individual statements, not wrapped in a D1 batch or transaction.

If any write fails mid-way, the data is left in a partially-merged state — some FK references point to the real user, others still reference the deleted dummy. This is a data corruption risk.

**Fix:** Wrap all claim operations in a D1 batch (`db.batch([...])`) to make it atomic. D1 supports batched writes.

---

## Major

### 4. Bot instantiated per request (`webhook.ts`)

**File:** `backend/src/webhook.ts` — line ~19

A new `Bot` instance is created on every webhook request. While grammY is lightweight, this means middleware, command handlers, and error handlers are re-registered on every invocation. In a Cloudflare Worker (stateless isolate per request), this is technically correct — but wasteful if the isolate is reused across requests.

**Fix:** Consider lazy-initializing the bot outside the handler and caching it per-isolate (module-level `let bot: Bot | null`). grammY's webhook handler is designed for this pattern.

---

### 5. O(N) balance computation on group detail (`groups.ts`)

**File:** `backend/src/api/groups.ts` — GET `/groups/:id`

Every time a group is fetched, balances are recomputed from scratch: query all expenses + all settlements + run `simplifyDebts()`. For groups with hundreds of expenses, this is O(N) on every page load.

**Impact:** Low for now (most groups have <50 expenses), but will degrade as groups grow.

**Fix (when needed):** Materialized balance cache in D1 (invalidated on expense/settlement mutations). Not urgent — measure first.

---

### 6. `callback_data` length risk (`reports.ts` / `webhook.ts`)

**File:** `backend/src/api/reports.ts` — inline keyboard buttons

Telegram's `callback_data` has a 64-byte limit. The current format includes action + type + key (e.g., `report_remove:receipt:groups/123/expenses/456/receipt.jpg`). R2 keys for receipts can be long — if the key exceeds ~50 chars, the callback will silently fail or be truncated by Telegram.

**Fix:** Store report metadata in D1 with a short ID, and use `report_remove:{shortId}` as callback_data. Or hash the R2 key.

---

### 7. Shared utils duplicated between backend and frontend

**Files:** `backend/src/utils/currencies.ts` + `frontend/src/utils/currencies.ts` (identical), same for `format.ts`

These are manually kept in sync. Any edit to one must be mirrored to the other. This is a maintenance risk — eventually they'll diverge.

**Fix options:**
- Extract to a shared workspace package (`packages/shared/`)
- Or use a symlink / build-time copy script
- Low priority — they've been kept in sync so far, but worth fixing before the codebase grows

---

### 8. No index on `expenses.group_id` for balance queries

**File:** `backend/src/db/schema.ts`

Balance computation queries `expenses` by `group_id` on every group page load. Without an index on `group_id`, D1 does a full table scan. Same concern for `settlements.group_id` and `expense_participants.expense_id`.

**Check:** Verify if D1 auto-creates indexes on foreign keys (SQLite does not by default). If not, add explicit indexes in a migration.

---

### 9. `response_destination` in TON message building

**File:** `frontend/src/utils/ton.ts` — `buildSettlementBody()`

The `response_destination` in the Jetton transfer message is set to `Address.parse('0:0000...')` (null address). This means excess gas from the Jetton transfer has nowhere to return to. The sender (debtor) loses any excess gas.

**Fix:** Set `response_destination` to the sender's address so excess gas is refunded.

---

### 10. Fixed gas attachment (0.5 TON)

**File:** `frontend/src/pages/SettleUp.tsx`

Every settlement attaches exactly 0.5 TON for gas, regardless of network conditions. Users get ~0.33 TON back, but:
- If gas prices change, 0.5 may not be enough
- Users see "0.5 TON" which looks expensive before the refund

**Fix:** Either estimate gas dynamically via TONAPI, or at minimum show the expected refund amount in the confirmation UI (e.g., "Gas: ~0.035 TON (0.5 TON attached, ~0.33 refunded)").

---

## Minor

### 11. No request deduplication on settlement creation

**File:** `backend/src/api/settlements.ts` — POST create settlement

If a user double-taps "Settle up", two settlements could be created for the same debt. There's no idempotency key or duplicate check.

**Fix:** Add a unique constraint on `(group_id, from_user, to_user, status='open')` or check for existing open settlements before creating.

---

### 12. `auth_date` 24h window is generous

**File:** `backend/src/middleware/auth.ts`

The `auth_date` max age is 86400s (24h). Telegram doesn't refresh `initData` mid-session, but a stolen initData string would be valid for 24 hours. For a financial app, this is a wide window.

**Mitigation:** This is acceptable because initData is only available inside the TG WebView (not extractable by third parties). But if the app ever has external API consumers, tighten this.

---

### 13. No rate limiting

No rate limiting on any endpoint. A malicious user could:
- Spam group creation
- Flood debt reminders (24h cooldown exists, but only per-creditor-per-debtor)
- Create thousands of expenses

**Fix:** Add Cloudflare rate limiting rules (free tier supports basic rules) or implement per-user rate limiting via D1/KV.

---

### 14. `processImage()` has no timeout

**File:** `frontend/src/utils/image.ts`

The Canvas-based image processing (`processImage`, `processAvatar`, `processReceipt`) has no timeout. A maliciously large image could hang the browser tab.

**Fix:** Add a timeout wrapper (e.g., `Promise.race` with a 10s deadline).

---

### 15. Hardcoded emoji list for group avatars

**File:** `frontend/src/pages/GroupSettings.tsx`

The emoji picker is a hardcoded array of 20 emojis. Adding more requires a code change.

**Non-issue for now** — but if users request more emojis, consider a data-driven approach or a proper emoji picker library.

---

### 16. Missing error boundary in React app

**File:** `frontend/src/App.tsx`

No React error boundary wrapping the app. An unhandled render error in any component crashes the entire app with a white screen.

**Fix:** Add a top-level `<ErrorBoundary>` component that shows a friendly "Something went wrong" message with a retry button.

---

### 17. `waitUntil()` errors are silently swallowed

**Files:** Throughout `backend/src/api/` — notification sends, R2 cleanup, activity logging

All `waitUntil()` promises catch errors silently. If a notification fails, R2 cleanup fails, or activity logging fails — there's no record of it.

**Fix:** Add structured logging (even just `console.error` with context) inside `waitUntil()` catch blocks. Cloudflare Workers logs are available in the dashboard.

---

### 18. Frontend polls with `setInterval` — no cleanup on unmount edge cases

**File:** `frontend/src/pages/SettleUp.tsx` — polling loop

The polling loop uses `setInterval` for checking settlement status. While there's a cleanup on component unmount, if the user navigates away during the polling → back → the old interval might not be properly cleared in all React StrictMode scenarios.

**Fix:** Use `useRef` for the interval ID and ensure cleanup in the effect's return. Or switch to recursive `setTimeout` which is safer for async operations.

---

## Documentation Discrepancies Found

### PLAN.md
- Phase 10 checklist was outdated (showed steps 2-6 as not done when they're all implemented). **Fixed.**

### docs/architecture.md
- Contract address was stale (showed v1 `EQC7KPpOr...` instead of v4 `EQBWECX8...`). **Fixed.**
- Migration table was missing 0008 and 0009. **Fixed.**
- Research table showed exchange rates and TON Connect as "Pending" — they're implemented. **Fixed.**
- Test count said 16 instead of 17. **Fixed.**
- Missing `exchange_rates` table in data model section. **Fixed.**
- Missing Phase 10 frontend integration details (TON Connect, exchange rates). **Fixed.**

---

## Summary

| Severity | Count | Key themes |
|----------|-------|------------|
| Critical | 3     | GET mutation, spoofable verification, non-atomic claim |
| Major    | 7     | Per-request bot init, O(N) balances, callback_data overflow, duplicated utils, missing indexes, gas handling |
| Minor    | 8     | No rate limiting, no error boundary, silent `waitUntil` errors, generous auth window |

**Top 3 priorities:**
1. Fix on-chain verification to check sender/recipient (security)
2. Wrap placeholder claim in D1 batch (data integrity)
3. Move settlement lazy-verify from GET to POST (HTTP correctness)
