# Notification Improvements

Priority: **Phase 2 deliverable**. Lower priority than bugs and settlement rework.

---

## N1. Reduce notification noise

**Problem:** Bot fires a notification for every single expense added. Groups with active expense tracking get spammed.

**Options (pick one):**
1. **Batch/digest:** Collect expenses over 5-10 minutes, send one summary. Complex — needs scheduled worker or KV-based queue.
2. **Mute per group:** User can mute notifications for a group. Simpler. Store `muted` flag on `group_members`.
3. **Smart throttle:** Max 1 notification per group per N minutes. Middle ground.

**Recommendation:** Start with option 2 (mute per group). Simplest, gives users control. Add `/mute` and `/unmute` bot commands for the group. Store on `group_members` table.

---

## N2. Settlement notification

- When a debt is marked as settled (manual), notify the other party
- "Alice marked the $15.00 debt as settled — paid via bank transfer"
- Include inline button to view the group

---

## N3. Bot 403 handling

**Problem:** `sendMessage` throws 403 when user hasn't `/start`ed the bot. Currently crashes silently.

**Fix:**
- Catch 403 in `sendMessage`
- Track `bot_started` flag on users table (or separate table)
- Set `bot_started = true` when user sends `/start`
- Skip notification attempts for users with `bot_started = false`
- Optionally: in group UI, show "Enable notifications" prompt that links to bot
