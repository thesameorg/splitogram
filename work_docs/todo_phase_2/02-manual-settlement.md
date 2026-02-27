# Manual Settlement Rework

Priority: **Phase 2 core deliverable**. Depends on: C1, C2 bug fixes.

---

## Goal

Either party (debtor OR creditor) can mark a debt as settled. Remove all crypto UI. Settlement creates a visible record in the group.

---

## S1. Settlement flow redesign

**Current state:** Only debtor can create settlement. Creditor's "mark as settled" button is broken (see C2). Crypto settle UI exists but is deferred.

**New flow:**
1. User taps "Settle up" on a balance → sees settlement screen
2. Screen shows: who owes whom, amount, currency
3. Two actions available:
   - **Debtor sees:** "Mark as paid" button
   - **Creditor sees:** "Mark as received" button
4. Optional comment field (e.g., "paid via bank transfer", "Venmo")
5. Settlement creates a record: `status = settled_external`, with comment
6. Both parties and group members notified

---

## S2. Remove crypto settlement UI

- Remove TON Connect from settle flow (keep code, just don't render)
- Remove USDT references from all user-facing text
- Remove wallet-related buttons and status indicators
- Keep backend settlement endpoints intact (dormant for Phase 3)

---

## S3. Settlement record in group activity

- Settlement shows in expense/activity list for the group
- Display: "Alice settled $15.00 with Bob — paid via bank transfer"
- Timestamp, participants, amount, optional comment

---

## S4. Backend changes

- `POST /api/v1/groups/:id/settlements` — allow both `fromUser` and `toUser` to create
- `POST /api/v1/settlements/:id/mark-external` — accept optional `comment` field
- New settlement status: consider simplifying to just `open` and `settled` for Phase 2 (remove `payment_pending`, `settled_onchain` from UI)
- Update debt graph to account for manual settlements

---

## S5. Frontend changes

- Settle screen: detect if current user is debtor or creditor
- Show appropriate button label ("Mark as paid" vs "Mark as received")
- Add optional comment input
- Remove TonConnectButton, wallet status, on-chain verification polling
- After settlement: navigate back to group with updated balances
