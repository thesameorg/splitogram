import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { expenses, expenseParticipants, groupMembers, groups, users } from '../db/schema';
import { notify } from '../services/notifications';
import type { AuthContext } from '../middleware/auth';
import type { DBContext } from '../middleware/db';

type ExpenseEnv = AuthContext & DBContext;

const expensesApp = new Hono<ExpenseEnv>();

const createExpenseSchema = z.object({
  amount: z.number().int().positive('Amount must be positive'),
  description: z.string().min(1).max(500),
  paidBy: z.number().int().positive().optional(), // user ID, defaults to current user
  participantIds: z.array(z.number().int().positive()).min(2, 'At least 2 participants required'),
});

// --- Create expense ---
expensesApp.post('/', zValidator('json', createExpenseSchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id') ?? '', 10);
  const { amount, description, paidBy, participantIds } = c.req.valid('json');

  if (isNaN(groupId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
  }

  // Resolve current user
  const [currentUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!currentUser) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  // Check current user is member
  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, currentUser.id)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  const payerId = paidBy ?? currentUser.id;

  // Verify payer is a group member
  const [payerMembership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, payerId)))
    .limit(1);

  if (!payerMembership) {
    return c.json({ error: 'payer_not_member', detail: 'Payer must be a group member' }, 400);
  }

  // Verify all participants are group members
  const groupMembersList = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));

  const memberIds = new Set(groupMembersList.map((m) => m.userId));
  for (const pid of participantIds) {
    if (!memberIds.has(pid)) {
      return c.json(
        { error: 'participant_not_member', detail: `User ${pid} is not a group member` },
        400,
      );
    }
  }

  // Payer must be in participants
  if (!participantIds.includes(payerId)) {
    return c.json(
      { error: 'payer_not_participant', detail: 'Payer must be included in participants' },
      400,
    );
  }

  // Calculate equal split (first participant absorbs remainder)
  const count = participantIds.length;
  const baseShare = Math.floor(amount / count);
  const remainder = amount - baseShare * count;

  // Create expense
  const [expense] = await db
    .insert(expenses)
    .values({
      groupId,
      paidBy: payerId,
      amount,
      description,
    })
    .returning();

  // Create participant records
  const participantValues = participantIds.map((userId, idx) => ({
    expenseId: expense.id,
    userId,
    shareAmount: idx === 0 ? baseShare + remainder : baseShare,
  }));

  await db.insert(expenseParticipants).values(participantValues);

  // Fire-and-forget notification
  const notifyCtx = {
    botToken: c.env.TELEGRAM_BOT_TOKEN,
    pagesUrl: c.env.PAGES_URL || '',
    onBotBlocked: (telegramId: number) => {
      db.update(users)
        .set({ botStarted: false })
        .where(eq(users.telegramId, telegramId))
        .catch(() => {});
    },
  };
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const [group] = await db
          .select({ name: groups.name, currency: groups.currency })
          .from(groups)
          .where(eq(groups.id, groupId))
          .limit(1);

        const [payer] = await db
          .select({
            telegramId: users.telegramId,
            displayName: users.displayName,
            botStarted: users.botStarted,
          })
          .from(users)
          .where(eq(users.id, payerId))
          .limit(1);

        // Get participants with muted status from group_members
        const participantUsers = await db
          .select({
            telegramId: users.telegramId,
            displayName: users.displayName,
            botStarted: users.botStarted,
            muted: groupMembers.muted,
          })
          .from(users)
          .innerJoin(
            groupMembers,
            and(eq(groupMembers.userId, users.id), eq(groupMembers.groupId, groupId)),
          )
          .where(inArray(users.id, participantIds));

        await notify.expenseCreated(
          notifyCtx,
          { id: expense.id, description, amount, groupId },
          payer,
          participantUsers,
          group.name,
          group.currency,
        );
      } catch (e) {
        console.error('Notification failed (expense_created):', e);
      }
    })(),
  );

  return c.json(
    {
      id: expense.id,
      groupId: expense.groupId,
      paidBy: expense.paidBy,
      amount: expense.amount,
      description: expense.description,
      createdAt: expense.createdAt,
      participants: participantValues.map((p) => ({
        userId: p.userId,
        shareAmount: p.shareAmount,
      })),
    },
    201,
  );
});

// --- List expenses for group ---
expensesApp.get('/', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id') ?? '', 10);

  if (isNaN(groupId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid group ID' }, 400);
  }

  // Resolve current user
  const [currentUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!currentUser) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  // Check membership
  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, currentUser.id)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  // Pagination
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '50', 10) || 50), 100);
  const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10) || 0);

  const expenseList = await db
    .select({
      id: expenses.id,
      paidBy: expenses.paidBy,
      payerName: users.displayName,
      amount: expenses.amount,
      description: expenses.description,
      createdAt: expenses.createdAt,
    })
    .from(expenses)
    .innerJoin(users, eq(expenses.paidBy, users.id))
    .where(eq(expenses.groupId, groupId))
    .orderBy(desc(expenses.createdAt))
    .limit(limit)
    .offset(offset);

  // For each expense, get participants
  const result = await Promise.all(
    expenseList.map(async (exp) => {
      const participants = await db
        .select({
          userId: expenseParticipants.userId,
          displayName: users.displayName,
          shareAmount: expenseParticipants.shareAmount,
        })
        .from(expenseParticipants)
        .innerJoin(users, eq(expenseParticipants.userId, users.id))
        .where(eq(expenseParticipants.expenseId, exp.id));

      return { ...exp, participants };
    }),
  );

  return c.json({ expenses: result });
});

// --- Edit expense ---
const editExpenseSchema = z.object({
  amount: z.number().int().positive().optional(),
  description: z.string().min(1).max(500).optional(),
  participantIds: z.array(z.number().int().positive()).min(2).optional(),
});

expensesApp.put('/:expenseId', zValidator('json', editExpenseSchema), async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id') ?? '', 10);
  const expenseId = parseInt(c.req.param('expenseId'), 10);
  const updates = c.req.valid('json');

  if (isNaN(groupId) || isNaN(expenseId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid ID' }, 400);
  }

  const [currentUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!currentUser) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  // Fetch expense
  const [expense] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId)))
    .limit(1);

  if (!expense) {
    return c.json({ error: 'expense_not_found', detail: 'Expense not found' }, 404);
  }

  // Only creator or group admin can edit
  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, currentUser.id)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  if (expense.paidBy !== currentUser.id && membership.role !== 'admin') {
    return c.json(
      { error: 'not_authorized', detail: 'Only the expense creator or group admin can edit' },
      403,
    );
  }

  // Update expense fields
  const expenseUpdates: Record<string, any> = {};
  if (updates.description !== undefined) expenseUpdates.description = updates.description;

  const newAmount = updates.amount ?? expense.amount;
  if (updates.amount !== undefined) expenseUpdates.amount = updates.amount;

  if (Object.keys(expenseUpdates).length > 0) {
    await db.update(expenses).set(expenseUpdates).where(eq(expenses.id, expenseId));
  }

  // Recalculate shares if participants or amount changed
  if (updates.participantIds || updates.amount) {
    const participantIds = updates.participantIds ??
      (await db
        .select({ userId: expenseParticipants.userId })
        .from(expenseParticipants)
        .where(eq(expenseParticipants.expenseId, expenseId))
      ).map((p) => p.userId);

    // Validate participants are group members
    if (updates.participantIds) {
      const groupMembersList = await db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, groupId));

      const memberIds = new Set(groupMembersList.map((m) => m.userId));
      for (const pid of participantIds) {
        if (!memberIds.has(pid)) {
          return c.json(
            { error: 'participant_not_member', detail: `User ${pid} is not a group member` },
            400,
          );
        }
      }

      if (!participantIds.includes(expense.paidBy)) {
        return c.json(
          { error: 'payer_not_participant', detail: 'Payer must be included in participants' },
          400,
        );
      }
    }

    // Recalculate equal split
    const count = participantIds.length;
    const baseShare = Math.floor(newAmount / count);
    const remainder = newAmount - baseShare * count;

    // Delete old participants and insert new
    await db.delete(expenseParticipants).where(eq(expenseParticipants.expenseId, expenseId));

    const participantValues = participantIds.map((userId, idx) => ({
      expenseId,
      userId,
      shareAmount: idx === 0 ? baseShare + remainder : baseShare,
    }));

    await db.insert(expenseParticipants).values(participantValues);
  }

  return c.json({ id: expenseId, updated: true });
});

// --- Delete expense ---
expensesApp.delete('/:expenseId', async (c) => {
  const db = c.get('db');
  const session = c.get('session');
  const groupId = parseInt(c.req.param('id') ?? '', 10);
  const expenseId = parseInt(c.req.param('expenseId'), 10);

  if (isNaN(groupId) || isNaN(expenseId)) {
    return c.json({ error: 'invalid_id', detail: 'Invalid ID' }, 400);
  }

  const [currentUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, session.telegramId))
    .limit(1);

  if (!currentUser) {
    return c.json({ error: 'user_not_found', detail: 'User not found' }, 404);
  }

  const [expense] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId)))
    .limit(1);

  if (!expense) {
    return c.json({ error: 'expense_not_found', detail: 'Expense not found' }, 404);
  }

  // Only creator or group admin can delete
  const [membership] = await db
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, currentUser.id)))
    .limit(1);

  if (!membership) {
    return c.json({ error: 'not_member', detail: 'You are not a member of this group' }, 403);
  }

  if (expense.paidBy !== currentUser.id && membership.role !== 'admin') {
    return c.json(
      { error: 'not_authorized', detail: 'Only the expense creator or group admin can delete' },
      403,
    );
  }

  // expense_participants cascade-deletes via FK onDelete: 'cascade'
  await db.delete(expenses).where(eq(expenses.id, expenseId));

  return c.json({ id: expenseId, deleted: true });
});

export { expensesApp };
