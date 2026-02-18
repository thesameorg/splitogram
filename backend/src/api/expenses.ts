import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, desc, sql } from 'drizzle-orm';
import { expenses, expenseParticipants, groupMembers, users } from '../db/schema';
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
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

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

export { expensesApp };
