# B. Data Model & Core Logic

Core backend logic. Unblocks bot, settlement, and frontend work.

**Database:** Cloudflare D1 (SQLite) via Drizzle ORM
**Validation:** Zod schemas on all endpoints via `@hono/zod-validator`
**API prefix:** All endpoints under `/api/v1` (playbook principle)

---

## B1. User Model & TG Auth

Auth is mostly copy-paste from template. Our additions: wallet address storage, upsert on auth.

**From template (copy-paste):**
- `telegram-auth.ts` — HMAC-SHA256 initData validation
- `session-manager.ts` — KV session management (UUID, TTL 3600s)
- `auth-middleware.ts` — `Authorization: Bearer` / `X-Session-ID` extraction + validation
- `auth.ts` API route — validate initData, create session, upsert user
- `mock-user.ts` — dev bypass with `DEV_AUTH_BYPASS_ENABLED`

**Our schema:**
```sql
users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id   INTEGER UNIQUE NOT NULL,
  username      TEXT,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  wallet_address TEXT,          -- TON wallet, set via TON Connect
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
)
```

- Upsert user on first auth (create if new, update username/avatar if changed)
- Wallet address stored when user connects TON wallet (separate endpoint, not during auth)
- Endpoint: `POST /api/v1/auth` → returns session token + user info

**Output:** User authenticates via TG initData, gets a session, subsequent calls are authenticated.

---

## B2. Groups & Membership

```sql
groups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  invite_code   TEXT UNIQUE NOT NULL,
  is_pair       INTEGER DEFAULT 0,    -- 1 for hidden 1-on-1 groups
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
)

group_members (
  group_id      INTEGER NOT NULL REFERENCES groups(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  role          TEXT DEFAULT 'member', -- 'creator' | 'member'
  joined_at     TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id)
)
```

- Endpoints:
  - `POST /api/v1/groups` — create group, creator auto-joined with role 'creator'
  - `GET /api/v1/groups` — list user's groups (with net balance per group)
  - `GET /api/v1/groups/:id` — group detail with members and balances
  - `POST /api/v1/groups/:id/join` — join via invite code
  - `GET /api/v1/groups/join/:invite_code` — resolve invite code (used by deep links)
- Bot `/start join_{invite_code}` calls internal join service function directly (not HTTP)
- Invite code: 8-char, URL-safe, unique (nanoid or crypto.randomUUID().slice)
- Deep link format: `https://t.me/splitogram_bot?start=join_{invite_code}`
- Joining triggers bot notification to existing group members

**Output:** Users can create groups, generate invite links, join groups via link.

---

## B3. Expenses & "Who Was Involved"

```sql
expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      INTEGER NOT NULL REFERENCES groups(id),
  paid_by       INTEGER NOT NULL REFERENCES users(id),
  amount        INTEGER NOT NULL,       -- in cents (USDT has 6 decimals on TON, store as micro-USDT)
  currency      TEXT DEFAULT 'USDT',
  description   TEXT NOT NULL,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
)

expense_participants (
  expense_id    INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  share_amount  INTEGER NOT NULL,       -- in same unit as expenses.amount
  PRIMARY KEY (expense_id, user_id)
)
```

- Phase 1 (equal splits): `share_amount` = `total / count(participants)` (handle rounding — first participant absorbs remainder)
- "Who was involved" = which users are in `expense_participants` (subset of group members)
- Endpoints:
  - `POST /api/v1/groups/:id/expenses` — create expense, body: `{ paid_by, amount, description, participant_ids[] }`
  - `GET /api/v1/groups/:id/expenses` — list expenses for group (paginated, most recent first)
- `participant_ids[]` includes the payer. Minimum 2 participants total (payer + at least 1 other).
- Validation (Zod): payer must be group member, all participants must be group members, amount > 0, at least 2 participants
- Creating expense triggers bot notification to all participants (except creator)

**Amount storage:** Store as integers in micro-USDT (1 USDT = 1,000,000). Avoids floating point. Display layer formats for humans.

**Output:** Expenses stored with per-participant shares. Not everyone has to be in every expense.

---

## B4. Debt Graph & Balance Calculation

```sql
settlements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      INTEGER NOT NULL REFERENCES groups(id),
  from_user     INTEGER NOT NULL REFERENCES users(id),
  to_user       INTEGER NOT NULL REFERENCES users(id),
  amount        INTEGER NOT NULL,       -- micro-USDT
  status        TEXT NOT NULL DEFAULT 'open',  -- open | payment_pending | settled_onchain | settled_external
  tx_hash       TEXT,                   -- TON transaction hash (null for external)
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  settled_at    TEXT
)
```

**Balance calculation:**
1. For each user in group: `net = SUM(expenses they paid for others) - SUM(their share in others' expenses) + SUM(settlements received) - SUM(settlements paid)`
2. One SQL query computes net balance per user per group

**Debt simplification** (`services/debt-solver.ts`, ~30 lines):
1. Compute net balance per person in group
2. Separate into creditors (positive balance) and debtors (negative balance)
3. Greedy match: pair largest creditor with largest debtor, transfer `min(credit, |debt|)`, repeat
4. Return list of `{ from, to, amount }` — the minimum set of transfers

- Recalculate on demand (not stored — computed from expenses + settlements)
- Endpoints:
  - `GET /api/v1/groups/:id/balances` — optimized debt graph for the group
  - `GET /api/v1/groups/:id/balances/me` — what the current user owes / is owed

**Output:** Given a set of expenses and settlements, returns the minimum set of transfers to settle all debts.

---

## B5. 1-on-1 Balances (No Group)

- Allow creating expenses between two users without a formal group
- Internally: auto-create a "pair group" (`is_pair = 1`, hidden from group list, exactly 2 members)
- Same data model, just a UX shortcut
- Endpoint: `POST /api/v1/expenses/direct` — body: `{ other_user_telegram_id, amount, description }`
- If pair group already exists for these two users, reuse it
- **Requires both users in system.** If other user not registered, return error with invite deep link. Status: "waiting for user to accept invitation."

**Output:** Two users can track debts between each other without creating a named group.
