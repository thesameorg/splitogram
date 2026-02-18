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
  createdAt: string;
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
  createdAt: string;
}

// --- API Functions ---

export const api = {
  // Groups
  listGroups: () => apiRequest<{ groups: GroupSummary[] }>('/api/v1/groups'),

  createGroup: (name: string) =>
    apiRequest<{ id: number; name: string; inviteCode: string }>('/api/v1/groups', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  getGroup: (id: number) => apiRequest<GroupDetail>(`/api/v1/groups/${id}`),

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

  // Balances
  getBalances: (groupId: number) =>
    apiRequest<{ debts: DebtEntry[] }>(`/api/v1/groups/${groupId}/balances`),

  getMyBalance: (groupId: number) =>
    apiRequest<MyBalance>(`/api/v1/groups/${groupId}/balances/me`),

  // Settlements
  createSettlements: (groupId: number) =>
    apiRequest<{ settlements: Settlement[] }>(`/api/v1/groups/${groupId}/settlements`, {
      method: 'POST',
    }),

  getSettlement: (id: number) => apiRequest<Settlement>(`/api/v1/settlements/${id}`),

  getSettlementTx: (id: number) =>
    apiRequest<{
      settlementId: number;
      amount: number;
      recipientAddress: string;
      usdtMasterAddress: string;
      comment: string;
    }>(`/api/v1/settlements/${id}/tx`),

  verifySettlement: (id: number, data: { boc?: string; txHash?: string }) =>
    apiRequest<{ status: string; txHash?: string; settlementId: number }>(
      `/api/v1/settlements/${id}/verify`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  markExternal: (id: number) =>
    apiRequest<{ status: string; settlementId: number }>(
      `/api/v1/settlements/${id}/mark-external`,
      { method: 'POST' },
    ),

  // Wallet
  setWallet: (address: string) =>
    apiRequest<{ walletAddress: string }>('/api/v1/users/me/wallet', {
      method: 'PUT',
      body: JSON.stringify({ address }),
    }),

  clearWallet: () =>
    apiRequest<{ walletAddress: null }>('/api/v1/users/me/wallet', {
      method: 'DELETE',
    }),
};
