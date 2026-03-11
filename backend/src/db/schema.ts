import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

// --- Users ---
export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    telegramId: integer('telegram_id').notNull(),
    username: text('username'),
    displayName: text('display_name').notNull(),
    walletAddress: text('wallet_address'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    botStarted: integer('bot_started', { mode: 'boolean' }).notNull().default(false),
    avatarKey: text('avatar_key'),
    isDummy: integer('is_dummy', { mode: 'boolean' }).notNull().default(false),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [uniqueIndex('users_telegram_id_idx').on(table.telegramId)],
);

// --- Groups ---
export const groups = sqliteTable(
  'groups',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    inviteCode: text('invite_code').notNull(),
    isPair: integer('is_pair', { mode: 'boolean' }).notNull().default(false),
    currency: text('currency').notNull().default('USD'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    avatarKey: text('avatar_key'),
    avatarEmoji: text('avatar_emoji'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    deletedAt: text('deleted_at'),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [uniqueIndex('groups_invite_code_idx').on(table.inviteCode)],
);

// --- Group Members ---
export const groupMembers = sqliteTable(
  'group_members',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ['admin', 'member'] })
      .notNull()
      .default('member'),
    muted: integer('muted', { mode: 'boolean' }).notNull().default(false),
    netBalance: integer('net_balance').notNull().default(0),
    joinedAt: text('joined_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex('group_members_unique_idx').on(table.groupId, table.userId),
    index('group_members_group_idx').on(table.groupId),
    index('group_members_user_idx').on(table.userId),
  ],
);

// --- Expenses ---
export const expenses = sqliteTable(
  'expenses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    paidBy: integer('paid_by')
      .notNull()
      .references(() => users.id),
    amount: integer('amount').notNull(), // micro-USDT (1 USDT = 1,000,000)
    description: text('description').notNull(),
    comment: text('comment'),
    splitMode: text('split_mode').notNull().default('equal'),
    receiptKey: text('receipt_key'),
    receiptThumbKey: text('receipt_thumb_key'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('expenses_group_idx').on(table.groupId),
    index('expenses_paid_by_idx').on(table.paidBy),
    index('expenses_created_at_idx').on(table.createdAt),
  ],
);

// --- Expense Participants ---
export const expenseParticipants = sqliteTable(
  'expense_participants',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    expenseId: integer('expense_id')
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    shareAmount: integer('share_amount').notNull(), // micro-USDT
  },
  (table) => [
    uniqueIndex('expense_participants_unique_idx').on(table.expenseId, table.userId),
    index('expense_participants_expense_idx').on(table.expenseId),
    index('expense_participants_user_idx').on(table.userId),
  ],
);

// --- Activity Log ---
export const activityLog = sqliteTable(
  'activity_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    actorId: integer('actor_id')
      .notNull()
      .references(() => users.id),
    type: text('type', {
      enum: [
        'group_created',
        'expense_created',
        'expense_edited',
        'expense_deleted',
        'settlement_completed',
        'member_joined',
        'member_left',
        'member_kicked',
        'placeholder_claimed',
        'member_deleted',
      ],
    }).notNull(),
    targetUserId: integer('target_user_id').references(() => users.id),
    expenseId: integer('expense_id'),
    settlementId: integer('settlement_id'),
    amount: integer('amount'),
    metadata: text('metadata'), // JSON
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('activity_log_group_idx').on(table.groupId),
    index('activity_log_created_at_idx').on(table.createdAt),
    index('activity_log_group_created_idx').on(table.groupId, table.createdAt),
    index('activity_log_actor_idx').on(table.actorId),
  ],
);

// --- Debt Reminders ---
export const debtReminders = sqliteTable(
  'debt_reminders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    fromUserId: integer('from_user_id')
      .notNull()
      .references(() => users.id),
    toUserId: integer('to_user_id')
      .notNull()
      .references(() => users.id),
    lastSentAt: text('last_sent_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex('debt_reminders_unique_idx').on(table.groupId, table.fromUserId, table.toUserId),
  ],
);

// --- Image Reports ---
export const imageReports = sqliteTable('image_reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  reporterTelegramId: integer('reporter_telegram_id').notNull(),
  imageKey: text('image_key').notNull(),
  reason: text('reason').notNull(),
  details: text('details'),
  status: text('status', { enum: ['pending', 'rejected', 'removed'] })
    .notNull()
    .default('pending'),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// --- Settlements ---
export const settlements = sqliteTable(
  'settlements',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    fromUser: integer('from_user')
      .notNull()
      .references(() => users.id),
    toUser: integer('to_user')
      .notNull()
      .references(() => users.id),
    amount: integer('amount').notNull(), // micro-USDT
    status: text('status', {
      enum: ['open', 'payment_pending', 'settled_onchain', 'settled_external'],
    })
      .notNull()
      .default('open'),
    txHash: text('tx_hash'),
    usdtAmount: integer('usdt_amount'), // micro-USDT (converted amount sent on-chain, null for external)
    commission: integer('commission'), // micro-USDT (fee taken by contract, null for external)
    comment: text('comment'),
    settledBy: integer('settled_by').references(() => users.id),
    receiptKey: text('receipt_key'),
    receiptThumbKey: text('receipt_thumb_key'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index('settlements_group_idx').on(table.groupId),
    index('settlements_from_user_idx').on(table.fromUser),
    index('settlements_to_user_idx').on(table.toUser),
    index('settlements_status_idx').on(table.status),
  ],
);
