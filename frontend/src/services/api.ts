import { config } from '../config';

const SESSION_KEY = 'splitogram_session_id';

export function getSessionId(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

export function setSessionId(id: string): void {
  localStorage.setItem(SESSION_KEY, id);
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const sessionId = getSessionId();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (sessionId) {
    headers['Authorization'] = `Bearer ${sessionId}`;
  }

  const response = await fetch(`${config.apiBaseUrl}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({
      error: 'unknown_error',
      detail: 'Unknown error',
    }));
    throw new ApiError(response.status, body.error, body.detail);
  }

  return response.json();
}

// --- Types ---

export interface GroupSummary {
  id: number;
  name: string;
  inviteCode: string;
  isPair: boolean;
  currency: string;
  createdAt: string;
  role: string;
  memberCount: number;
  netBalance: number;
}

export interface GroupMember {
  userId: number;
  telegramId: number;
  username: string | null;
  displayName: string;
  walletAddress: string | null;
  role: string;
  joinedAt: string;
}

export interface GroupDetail {
  id: number;
  name: string;
  inviteCode: string;
  isPair: boolean;
  currency: string;
  createdAt: string;
  createdBy: number;
  muted: boolean;
  members: GroupMember[];
}

export interface ExpenseParticipant {
  userId: number;
  displayName: string;
  shareAmount: number;
}

export interface Expense {
  id: number;
  paidBy: number;
  payerName: string;
  amount: number;
  description: string;
  createdAt: string;
  participants: ExpenseParticipant[];
}

export interface DebtUser {
  userId: number;
  displayName: string;
  username: string | null;
}

export interface DebtEntry {
  from: DebtUser;
  to: DebtUser;
  amount: number;
}

export interface MyBalance {
  netBalance: number;
  iOwe: Array<DebtUser & { amount: number }>;
  owedToMe: Array<DebtUser & { amount: number }>;
}

export interface Settlement {
  id: number;
  groupId: number;
  fromUser: number;
  toUser: number;
  amount: number;
  status: string;
  txHash: string | null;
  comment: string | null;
  settledBy: number | null;
  createdAt: string;
}

export interface SettlementDetail extends Settlement {
  currentUserId: number;
  currency: string;
  from: { userId: number; displayName: string; username: string | null; walletAddress: string | null };
  to: { userId: number; displayName: string; username: string | null; walletAddress: string | null };
}

// --- API Functions ---

export const api = {
  // Groups
  listGroups: () => apiRequest<{ groups: GroupSummary[] }>('/api/v1/groups'),

  createGroup: (name: string, currency: string = 'USD') =>
    apiRequest<{ id: number; name: string; inviteCode: string; currency: string }>(
      '/api/v1/groups',
      { method: 'POST', body: JSON.stringify({ name, currency }) },
    ),

  getGroup: (id: number) => apiRequest<GroupDetail>(`/api/v1/groups/${id}`),

  updateGroup: (id: number, data: { name?: string; currency?: string }) =>
    apiRequest<{ id: number; name: string; currency: string; inviteCode: string }>(
      `/api/v1/groups/${id}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),

  toggleMute: (id: number) =>
    apiRequest<{ muted: boolean }>(`/api/v1/groups/${id}/mute`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  regenerateInvite: (id: number) =>
    apiRequest<{ inviteCode: string }>(`/api/v1/groups/${id}/regenerate-invite`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  deleteGroup: (id: number, force = false) =>
    apiRequest<{ deleted: boolean; groupId: number }>(
      `/api/v1/groups/${id}${force ? '?force=true' : ''}`,
      { method: 'DELETE' },
    ),

  leaveGroup: (id: number) =>
    apiRequest<{ left: boolean; groupId: number }>(`/api/v1/groups/${id}/leave`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  joinGroup: (id: number, inviteCode: string) =>
    apiRequest<{ joined: boolean; groupId: number; groupName: string }>(
      `/api/v1/groups/${id}/join`,
      { method: 'POST', body: JSON.stringify({ inviteCode }) },
    ),

  resolveInvite: (inviteCode: string) =>
    apiRequest<{ id: number; name: string; isPair: boolean; memberCount: number }>(
      `/api/v1/groups/join/${inviteCode}`,
    ),

  // Expenses
  listExpenses: (groupId: number, limit = 50, offset = 0) =>
    apiRequest<{ expenses: Expense[] }>(
      `/api/v1/groups/${groupId}/expenses?limit=${limit}&offset=${offset}`,
    ),

  createExpense: (
    groupId: number,
    data: { amount: number; description: string; paidBy?: number; participantIds: number[] },
  ) =>
    apiRequest<Expense>(`/api/v1/groups/${groupId}/expenses`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  editExpense: (
    groupId: number,
    expenseId: number,
    data: { amount?: number; description?: string; participantIds?: number[] },
  ) =>
    apiRequest<{ id: number; updated: boolean }>(
      `/api/v1/groups/${groupId}/expenses/${expenseId}`,
      { method: 'PUT', body: JSON.stringify(data) },
    ),

  deleteExpense: (groupId: number, expenseId: number) =>
    apiRequest<{ id: number; deleted: boolean }>(
      `/api/v1/groups/${groupId}/expenses/${expenseId}`,
      { method: 'DELETE' },
    ),

  // Balances
  getBalances: (groupId: number) =>
    apiRequest<{ debts: DebtEntry[] }>(`/api/v1/groups/${groupId}/balances`),

  getMyBalance: (groupId: number) =>
    apiRequest<MyBalance>(`/api/v1/groups/${groupId}/balances/me`),

  // Settlements
  createSettlement: (groupId: number, fromUserId: number, toUserId: number) =>
    apiRequest<{ settlement: Settlement }>(`/api/v1/groups/${groupId}/settlements`, {
      method: 'POST',
      body: JSON.stringify({ fromUserId, toUserId }),
    }),

  getSettlement: (id: number) => apiRequest<SettlementDetail>(`/api/v1/settlements/${id}`),

  markExternal: (id: number, comment?: string) =>
    apiRequest<{ status: string; settlementId: number }>(
      `/api/v1/settlements/${id}/mark-external`,
      { method: 'POST', body: JSON.stringify({ comment }) },
    ),
};
