# Phase 1: Core Prototype — Summary

Completed 2026-02-27. See PLAN.md for what's next.

## What Was Built

- **Auth:** TG initData HMAC validation → KV sessions (1h TTL)
- **Groups:** Create, join via invite link, bot deep link join (`/start join_{code}`)
- **Expenses:** Add with equal splits, "who was involved" selector, paginated list
- **Balances:** Debt graph with greedy optimization (minimize transactions)
- **Bot:** grammY webhook, notifications wired to expense/settlement/join handlers via `waitUntil()`
- **Deep links:** Bot `?start=` and mini app `?startapp=` routing
- **Settlement:** On-demand creation from debt graph, TON Connect + TONAPI verification (basic), mark-external (creditor-only)
- **Frontend:** 4 pages (Home, Group, AddExpense, SettleUp), TG theme, hooks
- **CI/CD:** GitHub Actions → Cloudflare (build/test → deploy worker → deploy pages → webhook)
- **Tests:** Debt solver (5 cases). Frontend: Vitest configured, no tests yet.

Full API surface documented in CLAUDE.md.

## Key Findings from Manual Testing

Tested on deployed production (2026-02-27).

**Bugs:**
- `PAGES_URL` env var broken in deploy — wrangler `--var` uses `:` separator, CI had `=`. Bot replies crashed (empty Web App URL). **Fixed** in workflow.
- "USDT contract not configured" — `USDT_MASTER_ADDRESS` not set (moot now, crypto deferred)
- Creditor "mark as settled" button disabled despite spec allowing it
- "Please open in Telegram" flash on first open after redeploy

**Missing features (moved to Phase 2):**
- Edit/delete expense
- Group settings, delete, leave group
- Group currency
- Manual settlement by either party (not just creditor)
- UX: redundant buttons, unclear labels, no owner indicator

**Design feedback (moved to Phase 2):**
- Notifications too noisy (fires on every expense)
- Deep links: `join` and `group` should be merged
- Join flow should open the app, not just send a bot message
- "You owe" / "Owes you" labels instead of third-person names

**Deferred to Phase 3+ (crypto):**
- TON Connect wallet polish, wallet management screen
- On-chain verification hardening (sender/recipient/amount/memo)
- Testnet → mainnet, multiple wallets per user

## Known Technical Debt

- **Concurrent settlement race condition** — two users can settle same debt simultaneously. Fix: KV distributed lock. Not an issue until multi-user crypto settlement (Phase 3).
- **Bot 403 on users who haven't /started** — `sendMessage` throws if user never interacted with bot. Fix: catch 403, track `bot_started` flag. Phase 2.
- **Invite code collision** — nanoid(8) collisions negligible at MVP scale. DB unique constraint catches it. Add retry at scale.
