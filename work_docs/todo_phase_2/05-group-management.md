# Group Management

Priority: **Phase 2 deliverable**.

---

## GM1. Group settings page

**What:** Dedicated settings page for a group. Accessible from group header.

**Fields:**
- Group name (editable)
- Currency (editable — see 04-group-currency.md)
- Invite link (view, regenerate)
- Group creator indicator

**Backend:**
- `PATCH /api/v1/groups/:id` — update name, currency
- Only group creator (role = 'admin') can edit
- `POST /api/v1/groups/:id/regenerate-invite` — new invite code

**Frontend:**
- Settings icon/button on group page header
- Form with current values pre-filled
- Save button

---

## GM2. Delete group

**What:** Group creator can delete the group.

**Rules:**
- Only creator can delete
- All outstanding balances must be zero (settled) — or warn/confirm
- Deletes: group, group_members, expenses, expense_participants, settlements
- Cannot be undone

**Backend:**
- `DELETE /api/v1/groups/:id`
- Check: user is admin
- Check: all balances are zero (or require `?force=true` with confirmation)
- Cascade delete all related records

**Frontend:**
- "Delete group" button in group settings (red, dangerous)
- Confirmation dialog with group name
- After delete: navigate to home

---

## GM3. Leave group

**What:** Non-creator member can leave a group.

**Rules:**
- Cannot leave if you have outstanding balances (owe or are owed)
- Creator cannot leave (must delete or transfer ownership — transfer is Phase 2 stretch)
- Removes `group_members` row
- Group continues to exist for other members

**Backend:**
- `POST /api/v1/groups/:id/leave`
- Check: user is not admin
- Check: user's net balance is zero
- Delete group_members row
- Notify remaining members

**Frontend:**
- "Leave group" button in group settings
- If balance != 0: show message "Settle all debts before leaving"
- After leave: navigate to home

---

## GM4. Group owner indicator in UI

- Show crown/star icon next to group creator's name in member list
- Show "Created by {name}" in group settings
- Role is already stored as `group_members.role` ('admin' vs 'member')
