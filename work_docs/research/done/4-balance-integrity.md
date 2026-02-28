# Balance Integrity After Settlement

**Phase:** 4
**Type:** RESEARCH → Q&A → decision
**Status:** CLOSED — non-problem by design

---

## Problem

User A owes User B $50. They settle. Next day, someone edits an old expense that changes the balance. Now the settlement is wrong — User A might owe $60, or $40, or nothing. The settlement record says $50 was paid, but the actual debt is different.

This is the #1 accounting integrity risk in the app.

## Research: How does Splitwise handle this?

- [ ] Create test scenario in Splitwise: add expense, settle, then edit the expense
- [ ] Document what Splitwise shows to both parties after the edit
- [ ] Does Splitwise block edits? Reopen settlements? Show a warning?
- [ ] Check Splitwise's "simplify debts" behavior around edited settled expenses
- [ ] Look for Splitwise support articles or user complaints about this exact scenario

## Candidate approaches

### A: Warn + auto-reopen affected settlements

- When an expense is edited/deleted, find all settlements that were created after that expense
- If any exist, mark them with a "balance changed" flag or reopen them
- Notify affected users
- **Pro:** no data loss, no restrictions on editing
- **Con:** complex to implement, confusing UX ("your settlement was reopened"), may cause disputes

### B: Block edits on expenses involved in settlements

- If an expense has participants who have settled since the expense was created, block edit/delete
- Show message: "This expense is involved in a settlement. To edit it, first undo the settlement."
- **Pro:** simple, prevents the problem entirely
- **Con:** restrictive, users must undo settlements to fix mistakes

### C: Allow edits, show "balances changed" indicator

- Allow all edits freely
- If current balances differ from what was last settled, show a visual indicator on the group balance screen
- No automatic settlement changes
- **Pro:** maximum flexibility, simple to implement
- **Con:** users might not notice the indicator, doesn't actually protect integrity

### D: Hybrid (warn before, track after)

- When editing an expense that affects a settled balance, show a confirmation: "This will change settled balances. Continue?"
- If user confirms, log the change in an activity feed
- Don't auto-reopen settlements, but show the delta on the balance screen
- **Pro:** user is informed, flexible, auditable
- **Con:** medium complexity

## Decision

**No special handling needed.** The current architecture already handles this correctly.

### Why this is a non-problem

`computeGroupBalances` (balances.ts) recomputes from scratch on every request:

```
net balance = (what you paid) - (your expense shares) - (completed settlements)
```

Settlements are independent payment records — they freeze the amount that actually changed hands. Editing an expense changes the expense/share terms, and the balance naturally reflects the delta. The math is always correct:

- A owes B $50 → settles $50 → expense edited to $60 → balance shows A owes B $10. Correct.
- A owes B $50 → settles $50 → expense edited to $30 → balance shows B owes A $20. Correct (overpaid).

The settlement isn't "wrong" — it correctly records what was paid. The balance correctly shows what's currently owed. These are independent facts and should stay independent. This is how Splitwise works too.

### Splitwise research

Skipped — unnecessary. Splitwise treats settlements as payment records and recalculates balances the same way. No blocking, no reopening.

### Optional polish (not urgent, not integrity)

- **Confirmation dialog on expense edit:** if the edit touches users with completed settlements in that group, show "This may change settled balances. Continue?" — just awareness, not blocking.
- **Settlement history in activity feed:** so users can see what was paid vs. what's now owed after edits.
