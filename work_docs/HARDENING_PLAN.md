# Production Code Hardening Plan

Generated 2026-03-10 via code-tightener review of the full codebase.

## CRITICAL (fix before mainnet)

### C1. Settlement race condition
**File:** `backend/src/api/settlements.ts`
Two users can simultaneously mark the same settlement as paid. The status check and update aren't atomic. Fix: use D1 conditional update (`UPDATE ... WHERE status = 'open'`) and check `rowsAffected`.

### C2. Balance cache race condition
**File:** `backend/src/api/balances.ts`
`refreshGroupBalances()` does read-then-write. Concurrent expense creates in the same group can produce stale cached balances. Fix: wrap in a D1 batch or use `INSERT ... ON CONFLICT DO UPDATE` with computed values.

### C3. Settlement amount validation gap
**File:** `backend/src/api/settlements.ts`
The `markExternal` endpoint accepts an optional `amount` but doesn't validate it's positive or within reasonable bounds. A user could mark a settlement with amount `0` or a huge number.

### C4. Admin dashboard — no CSRF / no rate limiting
**File:** `backend/src/api/admin.ts`
The admin dashboard uses Basic Auth but has no CSRF protection. The image delete endpoint could be triggered by a malicious page if an admin is authenticated.

---

## HIGH

### H1. R2 upload — no file size limit enforcement
**File:** `backend/src/api/r2.ts`
Client-side Canvas compression exists, but the backend doesn't enforce a max upload size. A crafted request can upload arbitrarily large files to R2.

### H2. Expense amount overflow
**File:** `backend/src/api/expenses.ts`
Amounts are micro-units (integers). No upper bound validation. A crafted `amount` near `Number.MAX_SAFE_INTEGER` could cause overflow in share calculations.

### H3. Group invite code brute-force
**File:** `backend/src/api/groups.ts`
No rate limiting on invite code resolution. Invite codes are short enough to brute-force.

### H4. User profile update — no sanitization
**File:** `backend/src/api/users.ts`
`display_name` accepts arbitrary strings. Could contain control characters, extremely long strings, or HTML that gets rendered in bot notifications.

### H5. Missing member authorization on expense edit
**File:** `backend/src/api/expenses.ts`
Creator-only check exists for edit, but the `paid_by` field in an update could be set to a user not in the group — no membership validation on the new `paid_by`.

### H6. Unbounded group member list
**File:** `backend/src/api/groups.ts`
No limit on group members. A group with thousands of members would cause expensive queries on every expense operation (participant share calc, balance refresh).

### H7. Expense participant validation
**File:** `backend/src/api/expenses.ts`
Share amounts aren't validated to sum to the total expense amount on the backend. Frontend does this, but a crafted API call could create inconsistent splits.

### H8. Exchange rate staleness
**File:** `backend/src/services/exchange-rates.ts`
Cached exchange rates have a TTL but no staleness check at usage time. If the external API is down for days, settlement amounts could use very old rates.

---

## MEDIUM

### M1. No frontend error boundary
**File:** `frontend/src/App.tsx`
A React rendering error in any page crashes the entire app with a white screen. Add a top-level `ErrorBoundary`.

### M2. No request timeout on frontend API calls
**File:** `frontend/src/services/api.ts`
`apiRequest()` has no `AbortSignal.timeout()`. A hung backend keeps the UI loading forever.

### M3. Bot notification failures are completely silent
**File:** `backend/src/services/notifications.ts`
Failed notifications (non-403) are caught and swallowed. No logging, no metrics. Critical for debugging production issues.

### M4. Webhook has no signature verification
**File:** `backend/src/webhook.ts`
The `/webhook` endpoint doesn't verify the request comes from Telegram (no secret token validation). Anyone who discovers the URL can send fake bot updates.

### M5. Module-level bot cache shares state across requests
**File:** `backend/src/webhook.ts`
`currentEnv` is a module-level variable updated per-request. In theory, concurrent requests could read each other's env. Cloudflare Workers are single-threaded per isolate, but isolate reuse means this is a latent risk.

---

## LOW

### N1. Notification retry logic
**File:** `backend/src/services/notifications.ts`
Single bounded retry on failure. No exponential backoff, no dead-letter tracking.

### N2. Moderation service error logging
**File:** `backend/src/services/moderation.ts`
`removeImage()` errors are caught but not logged with context (which image, which report).

### N3. Webhook callback error handling
**File:** `backend/src/webhook.ts`
Bot callback query handlers don't answer the callback on error, leaving Telegram's loading spinner stuck.

### N4. Frontend settle-up polling without backoff
**File:** `frontend/src/pages/SettleUp.tsx`
TX polling uses fixed interval with no exponential backoff or max retry limit.

### N5. Group deletion doesn't clean up R2 images
**File:** `backend/src/api/groups.ts`
Deleting a group leaves orphaned avatar and receipt images in R2.

### N6. No user deletion / GDPR
**File:** `backend/src/api/users.ts`
No endpoint to delete user data. Potential GDPR compliance gap.

### N7. Stats queries on large groups
**File:** `backend/src/api/stats.ts`
Stats queries scan all expenses for a group with no pagination or caching. Could be slow for groups with thousands of expenses.

---

## Recommended Implementation Order

1. **C1 + C2** — Race conditions (settlement + balance cache) — highest blast radius
2. **C3 + H7** — Amount/share validation gaps — data integrity
3. **H1 + H2** — Upload size + amount overflow — abuse vectors
4. **M4** — Webhook signature verification — security
5. **M1 + M2** — Frontend resilience (error boundary + request timeouts)
6. **C4 + H3** — Admin CSRF + invite brute-force — security hardening
7. **H4 + H5 + H6** — Input sanitization + authorization gaps
8. **M3 + M5** — Observability + module-level state safety
9. **H8** — Exchange rate staleness guard
10. **Low priority items** as time permits
