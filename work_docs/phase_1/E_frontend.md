# E. Mini App Frontend

Telegram Mini App UI. Depends on backend APIs (B) and TON Connect (D1).

**Stack:** React 19 + Vite + Tailwind CSS + `@twa-dev/sdk` + `@tonconnect/ui-react`
**From template:** Vite config (proxy), API client pattern, TG hooks, Tailwind setup, React Router
**Routing:** React Router v7 (from template) or wouter (lighter) — decide during scaffold

---

## E1. Mini App Shell & Navigation

- Copy from template:
  - `frontend/vite.config.ts` — Vite dev proxy (`/api` → `localhost:8787`)
  - `frontend/src/config.ts` — API URL config from env
  - `frontend/src/services/api.ts` — fetch wrapper with session header injection (adapt for our endpoints)
  - `frontend/src/hooks/use-telegram-back-button.ts` — TG back button hook
  - `frontend/src/hooks/use-telegram-main-button.ts` — TG main button hook
  - Tailwind config + `index.css`
- Add:
  - `TonConnectUIProvider` wrapping the app (with testnet config + manifest URL)
  - `@twa-dev/sdk` initialization — read `initData`, `startParam`, theme vars
  - Auth on app load: send `initData` to `POST /api/v1/auth`, store session ID
  - Deep link routing: read `startParam`, navigate to correct view
- Navigation: stack-based routing (not tabs — expense splitters are inherently drill-down)
  - `/` — Home (group list)
  - `/groups/:id` — Group detail
  - `/groups/:id/add-expense` — Add expense
  - `/settle/:id` — Settlement flow
  - `/wallet` — Wallet management
- Respect Telegram theme: use CSS variables from `WebApp.themeParams`
- Back button handling via TG Mini App API (from template hooks)

**Output:** App loads inside Telegram, authenticates, shows navigation shell.

---

## E2. Home Screen

- List of user's groups: `GET /api/v1/groups`
  - Group name
  - Net balance (you owe / you're owed) — color coded (red = owe, green = owed)
  - Last activity timestamp
- Overall balance summary at top: total owed across all groups, total owed to you
- "Create Group" button → modal or inline form (name only)
- "1-on-1" quick action → select user by TG username
- Empty state for new users: "Create your first group" CTA
- Pull-to-refresh (if supported by TG WebApp)

**Output:** User sees all their groups and balances at a glance.

---

## E3. Group Detail Screen

- Header: group name, member avatars, invite link share button
- Tabs or sections:
  - **Expenses:** list (most recent first) — description, amount, who paid, date
  - **Balances:** who owes whom (optimized debt graph from `GET /api/v1/groups/:id/balances`)
- For each debt involving the current user:
  - You owe someone → "Settle Up" button
  - Someone owes you → "Remind" button (Phase 3) or "Mark Settled" button
- "Add Expense" floating action button
- Invite: share invite link via TG share dialog or copy to clipboard

**Output:** Full group context — expenses, balances, actions.

---

## E4. Add Expense Flow

- Form fields:
  - Description (text input, required)
  - Amount (number input, required, formatted as currency)
  - Paid by (default: current user, selectable from group members dropdown)
  - Split among (multi-select chips from group members, default: all)
- Equal split only in Phase 1 — show per-person amount live as `amount / selected_count`
- Validation (client-side + server-side):
  - Amount > 0
  - At least 2 participants (payer + at least 1 other)
  - Description not empty
- Submit → `POST /api/v1/groups/:id/expenses` → success → navigate back to group detail
- TG MainButton: "Add Expense" (use template's `use-telegram-main-button` hook)

**Output:** User can add an expense and select who's involved.

---

## E5. Settle Up Flow

- Entry: tap "Settle Up" on a debt from group detail
- Shows: "You owe Alice $15.00 USDT"
- Two paths:

**Path 1 — Pay with TON wallet (primary):**
1. If wallet not connected → show TON Connect modal (auto-triggered)
2. Wallet connected → show "Confirm Payment" with amount + recipient
3. Tap confirm → `POST /api/v1/groups/:id/settlements` to create settlement on demand, then `GET /api/v1/settlements/:id/tx` to get transaction params
4. `tonConnectUI.sendTransaction(tx)` → user approves in wallet app
5. Send BOC to `POST /api/v1/settlements/:id/verify`
6. Loading state while backend verifies on-chain (poll `GET /api/v1/settlements/:id` every 3s, "Refresh status" button)
7. Success → checkmark animation, debt cleared, navigate back
8. Failure → clear error message, "Try again" button

**Path 2 — Mark as settled externally (secondary):**
- Only visible to the creditor (person who is owed)
- Small text link: "Settled outside the app?"
- Tap → confirmation dialog → `POST /api/v1/settlements/:id/mark-external`
- Debt cleared with "settled externally" badge

**Output:** User settles a debt via wallet or marks it as externally settled.

---

## E6. Wallet Connection Screen

- Accessible from: profile/settings area + inline during settle up flow
- Uses `@tonconnect/ui-react` components:
  - `TonConnectButton` — shows connection status
  - Connected state: truncated address, wallet name/icon, "Disconnect" option
  - Disconnected state: "Connect Wallet" button → opens wallet selector modal
- After connecting: `PUT /api/v1/users/me/wallet` to store address on backend
- After disconnecting: `DELETE /api/v1/users/me/wallet` to clear

**Output:** User connects and manages their TON wallet within the mini app.
