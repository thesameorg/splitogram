import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// --- Users ---
export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    telegramId: integer("telegram_id").notNull().unique(),
    username: text("username"),
    displayName: text("display_name").notNull(),
    walletAddress: text("wallet_address"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("users_telegram_id_idx").on(table.telegramId),
  ],
);

// --- Groups ---
export const groups = sqliteTable(
  "groups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    inviteCode: text("invite_code").notNull().unique(),
    isPair: integer("is_pair", { mode: "boolean" }).notNull().default(false),
    createdBy: integer("created_by").notNull().references(() => users.id),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("groups_invite_code_idx").on(table.inviteCode),
  ],
);

// --- Group Members ---
export const groupMembers = sqliteTable(
  "group_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id").notNull().references(() => groups.id),
    userId: integer("user_id").notNull().references(() => users.id),
    role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
    joinedAt: text("joined_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("group_members_unique_idx").on(table.groupId, table.userId),
    index("group_members_group_idx").on(table.groupId),
    index("group_members_user_idx").on(table.userId),
  ],
);

// --- Expenses ---
export const expenses = sqliteTable(
  "expenses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id").notNull().references(() => groups.id),
    paidBy: integer("paid_by").notNull().references(() => users.id),
    amount: integer("amount").notNull(), // micro-USDT (1 USDT = 1,000,000)
    description: text("description").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("expenses_group_idx").on(table.groupId),
    index("expenses_paid_by_idx").on(table.paidBy),
    index("expenses_created_at_idx").on(table.createdAt),
  ],
);

// --- Expense Participants ---
export const expenseParticipants = sqliteTable(
  "expense_participants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    expenseId: integer("expense_id").notNull().references(() => expenses.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => users.id),
    shareAmount: integer("share_amount").notNull(), // micro-USDT
  },
  (table) => [
    uniqueIndex("expense_participants_unique_idx").on(table.expenseId, table.userId),
    index("expense_participants_expense_idx").on(table.expenseId),
    index("expense_participants_user_idx").on(table.userId),
  ],
);

// --- Settlements ---
export const settlements = sqliteTable(
  "settlements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id").notNull().references(() => groups.id),
    fromUser: integer("from_user").notNull().references(() => users.id),
    toUser: integer("to_user").notNull().references(() => users.id),
    amount: integer("amount").notNull(), // micro-USDT
    status: text("status", {
      enum: ["open", "payment_pending", "settled_onchain", "settled_external"],
    }).notNull().default("open"),
    txHash: text("tx_hash"),
    createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("settlements_group_idx").on(table.groupId),
    index("settlements_from_user_idx").on(table.fromUser),
    index("settlements_to_user_idx").on(table.toUser),
    index("settlements_status_idx").on(table.status),
  ],
);
