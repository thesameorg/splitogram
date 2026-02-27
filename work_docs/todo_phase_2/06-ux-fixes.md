# UX Fixes

Priority: **Phase 2 deliverable**. Most are small but improve daily usability significantly.

---

## UX1. "You owe" / "Owes you" labels

**Problem:** Settle screen shows third-person names for both sides. Should show "You owe Alice $15" or "Bob owes you $15" depending on perspective.

**Files:** `frontend/src/pages/SettleUp.tsx`, `frontend/src/pages/Group.tsx`

**Fix:** Compare settlement `fromUser`/`toUser` against current user ID. Use "You" where appropriate.

---

## UX2. Single "Create" button on AddExpense

**Problem:** Both TG MainButton and an in-page button exist for creating expense. Redundant.

**Fix:** Remove in-page submit button. Use only TG MainButton (bottom of screen). This is the Telegram Mini App convention.

---

## UX3. Deep link merge — `join` and `group` into one smart handler

**Problem:** Two deep link patterns (`join_{code}` and `group_{id}`) that could be one. User clicking an invite link to a group they're already in should just open the group, not show "already a member" error.

**Fix:** Single handler: if user is already a member → navigate to group. If not → join then navigate to group.

---

## UX4. Join flow should open the mini app

**Problem:** Bot join flow sends a message but doesn't open the mini app. User has to manually tap to open.

**Fix:** After successful join via bot, send an inline keyboard button that opens the mini app at the group page.

---

## UX5. Fix `expense_` deep link routing

**Problem:** `expense_` deep link uses expense ID as group ID — navigates to wrong page.

**Files:** `frontend/src/App.tsx:48-51`

**Fix:** Either remove this handler until expense detail page exists, or have backend return `groupId` with expense data so frontend can route correctly.

---

## UX6. Hide "Settled outside?" button from debtor

**Problem:** Button is visible to both debtor and creditor. Debtor clicking it gets a 403 error.

**Files:** `frontend/src/pages/SettleUp.tsx:206-213`

**Fix:** Only render when `settlement.toUser === currentUserId`.

---

## UX7. pollSettlement memory leak on unmount

**Problem:** If user navigates away during settlement polling (60s window), `setStatus` fires on unmounted component.

**Files:** `frontend/src/pages/SettleUp.tsx:96-110`

**Fix:** Add `useRef` cancellation flag, check it in the poll loop, clear on unmount.

---

## UX8. `settlement: any` type in SettleUp

**Problem:** `useState<any>(null)` — no type safety on settlement state.

**Fix:** Define `SettlementDetail` type in `api.ts` with enriched `from`/`to` objects. Use it.
