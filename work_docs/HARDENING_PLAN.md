# Production Code Hardening Plan

Generated 2026-03-10 via code-tightener review of the full codebase.

## CRITICAL (fix before mainnet) — ALL DONE

### C1. Settlement race condition ✅
**File:** `backend/src/api/settlements.ts`
**Was:** Status check and update weren't atomic — two users could simultaneously mark the same settlement as paid.
**Fix:** All settlement state transitions now use atomic conditional UPDATEs (`WHERE status = ...` + `.returning()` check). Returns 409 on race.

### C2. Balance cache race condition ✅
**File:** `backend/src/api/balances.ts`
**Was:** `refreshGroupBalances()` did read-then-write. Concurrent mutations could produce stale cached balances.
**Fix:** Replaced with single atomic SQL UPDATE using subqueries — computes and writes in one statement.

### C3. Settlement amount validation gap ✅
**File:** `backend/src/api/settlements.ts`, `backend/src/api/expenses.ts`
**Was:** No upper bound on amounts. Could overflow in share calculations.
**Fix:** Added `MAX_AMOUNT_MICRO` (10 trillion = $10M) cap on expenses (create + edit) and settlement amounts.

### C4. Admin dashboard — no CSRF ✅
**File:** `backend/src/api/admin.ts`
**Was:** POST endpoints had no CSRF protection. `returnTo` parameter allowed open redirect.
**Fix:** Origin/Referer validation on all admin POST requests. `returnTo` validated to start with `/admin`.

---

## HIGH — ALL DONE

### H1. R2 upload — no file size limit enforcement ✅
**File:** `backend/src/api/expenses.ts`, `backend/src/api/settlements.ts`, `backend/src/api/users.ts`
**Was:** Thumbnail uploads skipped `validateUpload()`. Feedback attachments had no size limit.
**Fix:** Thumbnails now validated via `validateUpload()` (5MB cap). Feedback attachments capped at 10MB per file.

### H2. Expense amount overflow ✅
Covered by C3 — `MAX_AMOUNT_MICRO` cap applied to all amount fields.

### H3. Group invite code brute-force — NOT AN ISSUE
8-char codes from 54-char alphabet = ~7.2×10^13 combinations. Endpoint requires TG auth. Brute force infeasible.

### H4. User profile update — no sanitization ✅
**Files:** `backend/src/api/users.ts`, `backend/src/api/groups.ts`, `backend/src/api/expenses.ts`
**Was:** String inputs could contain control characters rendered in bot notifications.
**Fix:** All user-facing string inputs now `.trim()` and strip control chars (`[\x00-\x1f\x7f]`).

### H5. Missing member authorization on expense edit — NOT AN ISSUE
Edit schema doesn't accept `paidBy` field — payer can't be changed during edit. Participants are validated.

### H6. Unbounded group member list ✅
**File:** `backend/src/api/groups.ts`
**Was:** No limit on group members. Large groups caused expensive queries.
**Fix:** 100-member cap enforced on join (`group_full` error).

### H7. Expense participant validation ✅
**File:** `backend/src/api/expenses.ts`
**Was:** Edit endpoint didn't validate percentage/manual split sums.
**Fix:** Added `superRefine` to edit schema — percentages must sum to 100, manual shares must sum to total.

### H8. Exchange rate staleness ✅
**File:** `backend/src/services/exchange-rates.ts`
**Was:** Stale rates used indefinitely when API was down.
**Fix:** Added `MAX_STALE_MS` (7 days). Rates older than 7 days are refused — returns null, caller shows error.

---

## MEDIUM — ALL DONE

### M1. No frontend error boundary ✅
**File:** `frontend/src/App.tsx`, `frontend/src/components/ErrorBoundary.tsx`
**Was:** React rendering error crashed the entire app with a white screen.
**Fix:** Added `ErrorBoundary` component wrapping the entire app. Shows "Something went wrong" with Reload button.

### M2. No request timeout on frontend API calls ✅
**File:** `frontend/src/services/api.ts`
**Was:** `apiRequest()` had no timeout. Hung backend kept UI loading forever.
**Fix:** Added `AbortSignal.timeout(30_000)` default on all API calls (overridable via `options.signal`).

### M3. Bot notification failures are completely silent ✅
**File:** `backend/src/services/notifications.ts`
**Was:** Retry failure logged the wrong error object (first attempt instead of retry).
**Fix:** Now logs the actual retry error. Logging was otherwise adequate (fires on final failure).

### M4. Webhook has no signature verification ✅
**File:** `backend/src/webhook.ts`, `scripts/webhook.sh`, `.github/workflows/4-setup-webhook.yml`
**Was:** No secret token validation — anyone who discovered the URL could send fake bot updates.
**Fix:** `deriveWebhookSecret()` generates deterministic HMAC-SHA256 secret from bot token. Webhook handler verifies `X-Telegram-Bot-Api-Secret-Token` header. Same derivation in bash scripts and CI workflow.

### M5. Module-level bot cache shares state across requests — NOT AN ISSUE
**File:** `backend/src/webhook.ts`
**Analysis:** CF Workers env bindings are identical across all requests to the same deployment. The module-level `currentEnv` pattern is safe because values never differ between concurrent requests. Documented with comment.

---

## LOW

### N1. Notification retry logic — SKIPPED
Current retry (1 retry after 1s, 403 handling) is adequate for fire-and-forget notifications at this scale.

### N2. Moderation service error logging ✅
**File:** `backend/src/services/moderation.ts`
**Was:** R2 delete failure in `removeImage()` threw and prevented DB cleanup.
**Fix:** Wrapped R2 delete in try-catch with logging. DB cleanup now runs regardless.

### N3. Webhook callback error handling ✅
**File:** `backend/src/webhook.ts`
**Was:** Unhandled errors left Telegram's callback spinner stuck.
**Fix:** Wrapped entire `callback_query:data` handler in try-catch. Answers callback with error message on failure.

### N4. Frontend settle-up polling without backoff — SKIPPED
Already bounded: 3s interval, 90s max (30 requests). Exponential backoff not worth the complexity.

### N5. Group deletion doesn't clean up R2 images — ALREADY HANDLED
R2 cleanup was already implemented: group avatar, expense receipts, and settlement receipts all cleaned up via `waitUntil()` on group delete.

### N6. No user deletion / GDPR — DEFERRED
Feature request, not hardening. Needs product decision on data retention policy.

### N7. Stats queries on large groups — DEFERRED
Move to later optimization pass. Not a security/correctness issue.
