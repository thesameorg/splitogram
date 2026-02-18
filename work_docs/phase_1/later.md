# Phase 1: Deferred & Clarified Decisions

Captured from code-tightener review. Items marked **LATER** are out of scope for Phase 1 MVP.

---

## Resolved (apply during implementation)

### Settlement creation: on demand

Settlement record created when user taps "Settle up" — `POST /api/v1/groups/:id/settlements` creates a new record from the debt graph, returns settlement ID. Then `GET /api/v1/settlements/:id/tx` returns transaction params. Idempotent by (group_id, from_user, to_user, status=open).

### API prefix: `/api/v1`

All API routes under `/api/v1`. Vite proxy forwards `/api` to backend.

### `payment_pending` stuck recovery: refresh button

No cron job in Phase 1. Add a "Refresh status" button on the settlement detail page. Backend re-checks TONAPI on tap. If still unverified after 10 minutes, allow manual rollback to `open`.

### Participant IDs include the payer

`participant_ids[]` in expense creation includes the payer. Minimum 2 participants total (payer + at least 1 other).

### Wallet validation: trust TON Connect

TON Connect and Telegram Wallet handle address validation. Backend stores whatever address the integration provides. No manual validation needed.

### Join flow: bot handler calls internal service

Two HTTP endpoints stay:

- `GET /api/v1/groups/join/:invite_code` — resolve invite code to group info (frontend display)
- `POST /api/v1/groups/:id/join` — actually join

Bot `/start join_{invite_code}` calls the join service function directly (not via HTTP). No coupling to the HTTP layer.

### 1-on-1 expenses: require both users in system

`POST /api/v1/expenses/direct` — if other user not in system, return error with invite deep link. Don't create placeholder users. Status: "waiting for user to accept invitation."

### Demo confirmation time: up to 60 seconds

TON testnet can be slow. Polling window is 60 seconds. Demo script should say "typically 5-30 seconds, up to a minute."

### Jetton wallet derivation: env-switched

USDT master contract address comes from env var (`USDT_MASTER_ADDRESS`). Different values for testnet vs mainnet. Derivation logic uses TONAPI to get sender's Jetton wallet address.

---

## LATER (post-Phase 1)

### Race condition on concurrent settlements

**Problem:** Two users can settle the same debt simultaneously. SQLite has no `SELECT FOR UPDATE`.
**Proposed fix:** Use KV as a distributed lock — `PUT settlements:{id}:lock` with short TTL before constructing tx params. If lock exists, return 409 Conflict.
**For now:** Single test user (developer) — race condition won't happen. Revisit when multi-user testing begins.

### Bot notification for users who haven't /started

**Problem:** `bot.sendMessage()` throws 403 if user never interacted with bot.
**Proposed fix:** Notification service should catch 403/400 and not retry (only retry on 5xx/timeout). Track `bot_started` flag per user.
**For now:** Developer is both test users and will /start the bot. Add proper handling in Phase 2.

### invite_code collision handling

At MVP scale with nanoid(8), collision probability is negligible. If it ever happens, the DB unique constraint will throw. Add retry-on-collision when it matters.
