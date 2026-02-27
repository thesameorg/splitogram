# Critical Bugs — Fix Before Next Deploy

Priority: **BLOCKING**. These are broken in production right now.

---

## C1. PAGES_URL broken — bot buttons link to nowhere

**Problem:** `PAGES_URL` is commented out in `wrangler.toml:25`. All bot notification buttons (expense added, member joined, settlement) link to an empty string. Users who click any bot button go nowhere.

**Files:** `wrangler.toml:25`, CI workflow

**Fix:**
- Uncomment default `PAGES_URL = "https://splitogram.pages.dev"` in wrangler.toml
- Add startup validation warning if `PAGES_URL` is empty
- CI override via `--var` still takes precedence

---

## C2. Creditor "Mark as Settled" is silently broken

**Problem:** Creditor clicks "Mark as Settled" → calls `createSettlements(groupId)` → API filters debts where `fromUser === currentUser.id` → creditor is `toUser` → `myDebts` is empty → `400 no_debts`. Button does nothing, no error shown.

**Files:** `frontend/src/pages/Group.tsx:218-225`, `backend/src/api/settlements.ts:53`

**Fix:**
- Route creditor to `mark-external` endpoint (already exists at `settlements.ts:392`)
- Frontend needs separate code paths for debtor vs creditor settle flow
- This is also part of the Phase 2 "manual settlement rework" deliverable

---

## C3. Webhook join breaks for groups with 101+ members

**Problem:** Fetches all members with `limit(100)` to check if user already joined. User #101+ is not in the result → `alreadyMember = false` → insert hits unique constraint → 500 error.

**Files:** `backend/src/webhook.ts:55-61`

**Fix:**
```ts
// Replace full member fetch with targeted query:
const [existing] = await db
  .select({ id: groupMembers.id })
  .from(groupMembers)
  .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, user.id)))
  .limit(1);
```

---

## C4. language_code validation rejects valid Telegram users

**Problem:** `z.string().length(2)` rejects BCP 47 tags like `zh-hans`, `pt-br`. Users with these language codes get `401 invalid_init_data` and cannot use the app at all.

**Files:** `backend/src/models/telegram-user.ts:19`

**Fix:** Change to `z.string().min(2)` — `language_code` isn't used in app logic.

---

## C5. Bot welcome message advertises non-existent crypto feature

**Problem:** `/start` message says "settle up with USDT on TON" but crypto UI is removed for Phase 2.

**Files:** `backend/src/webhook.ts:103`

**Fix:** Update to `"Split expenses with friends and settle up easily."`
