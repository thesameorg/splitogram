# Code Review — Architectural & Logic Concerns

Full codebase review performed 2026-03-09. Issues categorized by severity.

---

## Major

### 4. ~~Bot instantiated per request (`webhook.ts`)~~ — DONE

**File:** `backend/src/webhook.ts`

Module-level bot cache: `getOrCreateBot()` creates bot and registers handlers once per token. `currentEnv` variable updated per-request so handlers access fresh env via closure.

---

### 5. ~~O(N) balance computation on group detail~~ — DONE

**File:** `backend/src/api/balances.ts`, `backend/src/db/schema.ts`

Added `netBalance` column to `group_members` table. `refreshGroupBalances(db, groupId)` recomputes from source of truth (expenses + settlements) and writes to `group_members.netBalance`. Called after every balance-affecting mutation (expense create/edit/delete, settlement complete, member join/leave/kick). Read endpoints now pull cached value from `group_members` — no recomputation needed. Migration 0010.

---

### 6. ~~`callback_data` length risk~~ — DONE

**File:** `backend/src/api/reports.ts`, `backend/src/webhook.ts`, `backend/src/db/schema.ts`

Added `image_reports` table to store report metadata (reporter TG ID, image key, reason, details, status). Callback_data now uses `rj|{reportId}` / `rm|{reportId}` (max ~10 bytes) instead of embedding the full R2 key. Webhook handler looks up report from DB, checks for duplicate processing (`status !== 'pending'`), and updates status on action. Migration 0011.

---

### 7. ~~Shared utils duplicated between backend and frontend~~ — DONE

**Files:** `packages/shared/src/currencies.ts`, `packages/shared/src/format.ts`

Extracted to `@splitogram/shared` workspace package. Backend and frontend utils re-export from the shared package — all existing imports continue to work unchanged.

---

### 8. ~~Missing indexes on `activity_log`~~ — DONE

**File:** `backend/src/db/schema.ts`

Added compound index `activity_log_group_created_idx` on `(groupId, createdAt)` for cursor pagination, and `activity_log_actor_idx` on `actorId` for user activity queries. Note: `expenses.group_id`, `settlements.group_id`, and `expense_participants.expense_id` already had indexes. Migration 0010.

---

### 9. ~~`response_destination` in TON message building~~ — DONE

**File:** `frontend/src/utils/ton.ts`

Changed `response_destination` from `contractAddress` to `senderJettonWallet` so excess gas is refunded to the sender instead of being locked in the contract.

---

### 10. ~~Fixed gas attachment (0.5 TON)~~ — DONE

**File:** `backend/src/api/settlements.ts`

Dynamic gas calculation based on testnet profiling: base 0.3 TON (2 outgoing Jetton transfers) + 0.05 TON overhead + 0.1 TON contingency, rounded up to nearest 0.1 TON. Result: 0.5 TON (same as before for now, but formula adapts if base costs change). `forwardTonAmount` set to 0.35 TON (was hardcoded 0.4 TON).

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

| Severity | Count | Key themes                                                                                                   |
| -------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| Critical | 3     | ~~GET mutation, spoofable verification, non-atomic claim~~ — ALL DONE                                        |
| Major    | 7     | ~~Per-request bot, O(N) balances, callback_data, duplicated utils, missing indexes, gas handling~~ — ALL DONE |
| Minor    | 8     | No rate limiting, no error boundary, silent `waitUntil` errors, generous auth window                         |

**Critical (1-3):** All fixed (2026-03-09)

1. ~~Fix on-chain verification to check sender/recipient (security)~~ — DONE
2. ~~Wrap placeholder claim in D1 batch (data integrity)~~ — DONE
3. ~~Move settlement lazy-verify from GET to POST (HTTP correctness)~~ — DONE

**Major (4-10):** All fixed (2026-03-09)

4. ~~Bot per-request → module-level cache~~ — DONE
5. ~~O(N) balances → rolling `netBalance` on `group_members`~~ — DONE
6. ~~callback_data overflow → `image_reports` table with short ID~~ — DONE
7. ~~Duplicated utils → `@splitogram/shared` workspace package~~ — DONE
8. ~~Missing indexes → compound `activity_log` indexes~~ — DONE
9. ~~`response_destination` → sender's Jetton wallet~~ — DONE
10. ~~Fixed gas → dynamic calculation with contingency~~ — DONE
