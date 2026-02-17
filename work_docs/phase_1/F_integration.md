# F. Integration & Polish

Wire everything together. Last step before demo.

**Deployment:** Cloudflare Workers (backend) + Pages (frontend)
**Testing:** Vitest (from template), integration-first (playbook principle)

---

## F1. End-to-End Flow Testing

Test the full cycle with 3+ testers on real devices:

1. User A creates group → gets invite link
2. User A shares link in Telegram chat
3. User B taps link → bot /start handler → auto-joins group → gets "Open Group" button
4. User A adds expense ($30 dinner, split among A, B, C — selects "who was involved")
5. Users B and C receive bot notifications with "View Expense" button
6. User B taps notification → opens mini app → sees group with debt
7. User B taps "Settle up" → connects testnet Tonkeeper → approves tx
8. Backend verifies on TONAPI → debt marked `settled_onchain`
9. User A gets settlement notification
10. User C has no wallet → User A (creditor) marks C's debt as "settled externally"
11. All debts settled → group balance shows $0

**Deploy verification script** (playbook principle):
- Hit `GET /health` → 200
- Hit `POST /v1/auth` with test initData → valid session
- Verify bot webhook is set (`scripts/webhook.sh`)
- Verify Pages serves frontend → 200

**Output:** Full cycle works on testnet with real TG accounts and real wallet apps.

---

## F2. Deep Link Verification

Verify every deep link path works:

| Link | Expected |
|------|----------|
| `t.me/splitogram_bot?start=` | Welcome message + "Open App" button |
| `t.me/splitogram_bot?start=join_{code}` | Auto-join group + "Open Group" button |
| `t.me/splitogram_bot?startapp=group_{id}` | Mini App opens at group detail |
| `t.me/splitogram_bot?startapp=expense_{id}` | Mini App opens at expense detail |
| `t.me/splitogram_bot?startapp=settle_{id}` | Mini App opens at settlement flow |

- Test on iOS Telegram + Android Telegram
- Test with Tonkeeper (testnet) and Telegram Wallet
- Verify inline button taps from bot notifications work

**Output:** Every notification leads to the right screen in the mini app.

---

## F3. Error States & Edge Cases

| Scenario | Expected behavior |
|----------|------------------|
| Settle but wallet has no testnet USDT | Pre-flight check → clear error: "Insufficient USDT balance" |
| Wallet disconnects mid-settlement | Detect disconnect → "Wallet disconnected, reconnect to continue" |
| Two users settle same debt simultaneously | First one wins (DB status check before tx construction), second gets "Already settled" |
| Open invite link for group you're already in | "You're already in this group" → redirect to group |
| Group has only 1 member | No debts, empty balance view, prompt to invite |
| Expense amount very small (<$0.01 per person) | Minimum amount validation: reject if any share < $0.01 |
| Backend is cold/slow | Frontend shows loading states, timeouts at 10s with retry button |
| TONAPI is unreachable | Settlement stays in `payment_pending`, user sees "Verification in progress, check back soon" |
| Invalid/expired invite code | "This invite link is no longer valid" |
| User not yet started bot (no chat with bot) | Bot notification fails silently — user can still use the app via direct link |

**Output:** No unhandled error states. User always knows what's happening.

---

## F4. Demo Preparation

- Set up testnet USDT in 3-5 test wallets (Tonkeeper testnet mode)
- Prepare demo script:
  ```
  1. Open Telegram → tap bot link → "Open App"
  2. Create group "Dinner Squad"
  3. Share invite link → 2 friends join (bot notifications appear)
  4. Add expense: "Sushi dinner — $45 — split among 3"
  5. Switch to friend's phone → notification appeared → tap → see debt
  6. Tap "Settle Up" → connect Tonkeeper → approve $15 USDT transfer
  7. On-chain confirmation in ~5s → debt cleared → group notified
  8. Total demo time: ~2 minutes
  ```
- Screen recording for async stakeholders
- Document known limitations and what's coming in Phase 2

**Output:** Stakeholder demo ready. Clear story of what works and what's next.
