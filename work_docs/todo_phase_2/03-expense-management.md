# Expense Management — Edit & Delete

Priority: **Phase 2 deliverable**.

---

## E1. Edit expense

**What:** After creating an expense, user can edit amount, description, and participants.

**Backend:**
- `PUT /api/v1/expenses/:id` — update expense fields
- Only expense creator can edit (or group admin?)
- Recalculate `expense_participants` shares when participants change
- Zod validation on input (same schema as create, all fields optional)
- Recalculate group balances after edit

**Frontend:**
- Edit button on expense detail/list item
- Reuse AddExpense page with pre-filled values
- "Save" updates the expense, "Cancel" discards

**Edge cases:**
- Editing an expense that has settlements against it — block edit? Warn user?
- Decision needed: allow editing amount if settlements exist? Probably not — require delete + recreate.

---

## E2. Delete expense

**What:** Remove an expense from the group. Recalculates all balances.

**Backend:**
- `DELETE /api/v1/expenses/:id`
- Only expense creator (or group admin) can delete
- Cascade delete `expense_participants` rows
- If settlements reference this expense's debts, handle gracefully

**Frontend:**
- Delete button with confirmation dialog ("Are you sure? This will recalculate all balances.")
- After delete: navigate back to group, balances refreshed

**Edge cases:**
- Deleting an expense that caused a settlement — the settlement record should remain as historical, but balances recalculate without the deleted expense
