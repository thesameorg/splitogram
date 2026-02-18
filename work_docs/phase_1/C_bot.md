# C. Telegram Bot & Notifications

The engagement loop. Without this, nobody knows anything happened.

**Framework:** grammY (from template)
**Webhook:** Single `/webhook` endpoint on the Worker (from template)
**From template:** Bot setup pattern in `backend/src/webhook.ts` — adapt commands and handlers.

---

## C1. Bot Setup & Webhook

Copy bot setup pattern from template's `webhook.ts`. Template already handles grammY + webhook in a Worker.

- Register bot with @BotFather, get token
- Webhook URL set via GitHub Actions pipeline (from template: `4-setup-webhook.yml`)
- `/webhook` endpoint receives Telegram updates, dispatches to grammY
- Commands:
  - `/start` (no params) → welcome message + "Open App" inline button (Mini App link)
  - `/start join_{invite_code}` → look up group, auto-join user, send confirmation + "Open Group" button
  - `/start group_{group_id}` → send "Open Group" button
- Bot profile: set name, description, avatar, mini app button via BotFather
- Error handling: bot errors logged, never crash the Worker
- **Join handler calls internal service directly** — the bot `/start join_{code}` handler queries the DB and inserts group membership directly, not via HTTP endpoints

**From template:** grammY webhook handler pattern, Hono route for `/webhook`

**Output:** Bot responds to /start, handles deep links, shows Mini App button.

---

## C2. Notification Service

`backend/src/services/notifications.ts` — internal module, called by API handlers after state changes.

- **Not a webhook consumer** — this is the sending side. API handlers call `notify.expenseCreated(...)` etc.
- Event types:
  - `expense_created(expense, group)` → notify all participants except the creator
  - `settlement_completed(settlement, group)` → notify the creditor
  - `member_joined(user, group)` → notify existing group members
- Message formatting: Telegram HTML mode
- Include inline keyboard buttons on every notification:
  - "View Expense" → `https://t.me/splitogram_bot?startapp=expense_{expense_id}`
  - "Settle Up" → `https://t.me/splitogram_bot?startapp=settle_{debt_id}`
  - "Open Group" → `https://t.me/splitogram_bot?startapp=group_{group_id}`
- Needs user's `telegram_id` to send DM — look up from `users` table
- Timeout on every bot API call (playbook principle): `AbortSignal.timeout(5000)` or grammY's built-in timeout
- Bounded retry on send failure: 1 retry with 1s delay, then give up (don't block the request)

**Output:** App events trigger bot messages with actionable inline buttons.

---

## C3. Deep Link Routing

Two types of deep links in Telegram Mini Apps:

1. **Bot deep links** (`?start=` param): `https://t.me/splitogram_bot?start=join_{invite_code}`
   - Handled by bot's `/start` command handler
   - Used for: group invites (join before opening app)

2. **Mini App deep links** (`?startapp=` param): `https://t.me/splitogram_bot?startapp=group_{group_id}`
   - Opens Mini App directly with `startParam` in WebApp context
   - Frontend router reads `startParam` on mount → navigates to correct view
   - Used for: opening specific group, expense, settlement flow

**Parameter scheme:**

- `join_{invite_code}` — join a group (bot deep link, `/start` handler)
- `group_{group_id}` — open a specific group (mini app deep link)
- `expense_{expense_id}` — open a specific expense (mini app deep link)
- `settle_{settlement_id}` — open settlement flow (mini app deep link)

**Frontend handling:**

```typescript
const startParam = WebApp.initDataUnsafe.start_param;
if (startParam?.startsWith('group_')) navigate(`/groups/${id}`);
if (startParam?.startsWith('expense_')) navigate(`/groups/.../expenses/${id}`);
if (startParam?.startsWith('settle_')) navigate(`/settle/${id}`);
```

**Output:** Tapping a bot notification opens the mini app at the right screen.

---

## C4. Settlement Notifications in Chat

- When a settlement occurs (on-chain or external), notification service sends:
  - To creditor: "Alice settled $12.50 with you" (with checkmark)
  - To debtor (confirmation): "You settled $12.50 with Bob"
- For on-chain: include truncated tx hash as proof
- For external: label as "settled externally"
- Phase 1: all notifications are private bot DMs to each user
- Phase 5 (growth): post settlement confirmations to TG group chats for social proof

**Output:** Settlements generate visible confirmation messages.
