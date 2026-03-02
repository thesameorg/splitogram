import { config } from '../config';

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

function getInitData(): string | null {
  return window.Telegram?.WebApp?.initData || null;
}

export async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string>),
  };

  const initData = getInitData();
  if (initData) {
    headers['Authorization'] = `tma ${initData}`;
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
  avatarKey: string | null;
  avatarEmoji: string | null;
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
  avatarKey: string | null;
  role: string;
  joinedAt: string;
}

export interface GroupDetail {
  id: number;
  name: string;
  inviteCode: string;
  isPair: boolean;
  currency: string;
  avatarKey: string | null;
  avatarEmoji: string | null;
  createdAt: string;
  createdBy: number;
  muted: boolean;
  hasTransactions: boolean;
  members: GroupMember[];
}

export interface ExpenseParticipant {
  userId: number;
  displayName: string;
  shareAmount: number;
}

export type SplitMode = 'equal' | 'percentage' | 'manual';

export interface Expense {
  id: number;
  paidBy: number;
  payerName: string;
  amount: number;
  description: string;
  splitMode: SplitMode;
  receiptKey: string | null;
  receiptThumbKey: string | null;
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

export interface BalanceMember {
  userId: number;
  displayName: string;
  username: string | null;
  avatarKey: string | null;
  netBalance: number;
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
  receiptKey: string | null;
  receiptThumbKey: string | null;
  createdAt: string;
}

export interface SettlementDetail extends Settlement {
  currentUserId: number;
  currency: string;
  from: {
    userId: number;
    displayName: string;
    username: string | null;
    walletAddress: string | null;
  };
  to: {
    userId: number;
    displayName: string;
    username: string | null;
    walletAddress: string | null;
  };
}

export interface SettlementListItem {
  id: number;
  groupId: number;
  fromUser: number;
  fromUserName: string;
  toUser: number;
  toUserName: string;
  amount: number;
  status: string;
  comment: string | null;
  receiptKey: string | null;
  receiptThumbKey: string | null;
  createdAt: string;
}

export interface ActivityItem {
  id: number;
  groupId: number;
  groupName: string;
  currency: string;
  actorId: number;
  actorName: string;
  actorAvatarKey: string | null;
  type: string;
  targetUserId: number | null;
  targetUserName: string | null;
  expenseId: number | null;
  settlementId: number | null;
  amount: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface UserProfile {
  id: number;
  telegramId: number;
  displayName: string;
  username: string | null;
  avatarKey: string | null;
}

// --- API Functions ---

export const api = {
  // Auth
  authenticate: () =>
    apiRequest<{
      authenticated: boolean;
      user: { id: number; displayName: string; username: string | null };
    }>('/api/v1/auth', { method: 'POST', body: JSON.stringify({}) }),

  // Users
  getMe: () => apiRequest<UserProfile>('/api/v1/users/me'),
  updateMe: (data: { displayName: string }) =>
    apiRequest<{ displayName: string }>('/api/v1/users/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  uploadAvatar: (blob: Blob) => {
    const formData = new FormData();
    formData.append('avatar', blob, 'avatar.jpg');
    return apiRequest<{ avatarKey: string }>('/api/v1/users/me/avatar', {
      method: 'POST',
      headers: {},
      body: formData,
    });
  },
  deleteAvatar: () =>
    apiRequest<{ deleted: boolean }>('/api/v1/users/me/avatar', { method: 'DELETE' }),
  sendFeedback: (message: string, files?: File[]) => {
    const formData = new FormData();
    formData.append('message', message);
    if (files) {
      files.slice(0, 5).forEach((file, i) => {
        formData.append(`attachment_${i}`, file, file.name);
      });
    }
    return apiRequest<{ sent: boolean }>('/api/v1/users/feedback', {
      method: 'POST',
      body: formData,
    });
  },

  // Groups
  listGroups: () => apiRequest<{ groups: GroupSummary[] }>('/api/v1/groups'),

  createGroup: (name: string, currency: string = 'USD') =>
    apiRequest<{ id: number; name: string; inviteCode: string; currency: string }>(
      '/api/v1/groups',
      { method: 'POST', body: JSON.stringify({ name, currency }) },
    ),

  getGroup: (id: number) => apiRequest<GroupDetail>(`/api/v1/groups/${id}`),

  updateGroup: (
    id: number,
    data: { name?: string; currency?: string; avatarEmoji?: string | null },
  ) =>
    apiRequest<{ id: number; name: string; currency: string; inviteCode: string }>(
      `/api/v1/groups/${id}`,
      { method: 'PATCH', body: JSON.stringify(data) },
    ),

  uploadGroupAvatar: (groupId: number, blob: Blob) => {
    const formData = new FormData();
    formData.append('avatar', blob, 'avatar.jpg');
    return apiRequest<{ avatarKey: string }>(`/api/v1/groups/${groupId}/avatar`, {
      method: 'POST',
      headers: {},
      body: formData,
    });
  },
  deleteGroupAvatar: (groupId: number) =>
    apiRequest<{ deleted: boolean }>(`/api/v1/groups/${groupId}/avatar`, { method: 'DELETE' }),

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

  kickMember: (groupId: number, userId: number) =>
    apiRequest<{ kicked: boolean; groupId: number; userId: number }>(
      `/api/v1/groups/${groupId}/members/${userId}`,
      { method: 'DELETE' },
    ),

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
    data: {
      amount: number;
      description: string;
      paidBy?: number;
      participantIds: number[];
      splitMode?: SplitMode;
      shares?: Array<{ userId: number; value: number }>;
    },
  ) =>
    apiRequest<Expense>(`/api/v1/groups/${groupId}/expenses`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  editExpense: (
    groupId: number,
    expenseId: number,
    data: {
      amount?: number;
      description?: string;
      participantIds?: number[];
      splitMode?: SplitMode;
      shares?: Array<{ userId: number; value: number }>;
    },
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

  uploadReceipt: (groupId: number, expenseId: number, receipt: Blob, thumbnail: Blob) => {
    const formData = new FormData();
    formData.append('receipt', receipt, 'receipt.jpg');
    formData.append('thumbnail', thumbnail, 'thumbnail.jpg');
    return apiRequest<{ receiptKey: string; receiptThumbKey: string | null }>(
      `/api/v1/groups/${groupId}/expenses/${expenseId}/receipt`,
      { method: 'POST', headers: {}, body: formData },
    );
  },
  deleteReceipt: (groupId: number, expenseId: number) =>
    apiRequest<{ deleted: boolean }>(`/api/v1/groups/${groupId}/expenses/${expenseId}/receipt`, {
      method: 'DELETE',
    }),

  // Balances
  // Reminders
  sendReminder: (groupId: number, toUserId: number) =>
    apiRequest<{ sent: boolean }>(`/api/v1/groups/${groupId}/reminders`, {
      method: 'POST',
      body: JSON.stringify({ toUserId }),
    }),

  getBalances: (groupId: number) =>
    apiRequest<{ debts: DebtEntry[]; members: BalanceMember[] }>(
      `/api/v1/groups/${groupId}/balances`,
    ),

  getMyBalance: (groupId: number) => apiRequest<MyBalance>(`/api/v1/groups/${groupId}/balances/me`),

  // Settlements
  listSettlements: (groupId: number) =>
    apiRequest<{ settlements: SettlementListItem[] }>(`/api/v1/groups/${groupId}/settlements`),

  createSettlement: (groupId: number, fromUserId: number, toUserId: number) =>
    apiRequest<{ settlement: Settlement }>(`/api/v1/groups/${groupId}/settlements`, {
      method: 'POST',
      body: JSON.stringify({ fromUserId, toUserId }),
    }),

  getSettlement: (id: number) => apiRequest<SettlementDetail>(`/api/v1/settlements/${id}`),

  markExternal: (id: number, comment?: string, amount?: number) =>
    apiRequest<{ status: string; settlementId: number }>(
      `/api/v1/settlements/${id}/mark-external`,
      { method: 'POST', body: JSON.stringify({ comment, amount }) },
    ),

  uploadSettlementReceipt: (settlementId: number, receipt: Blob, thumbnail: Blob) => {
    const formData = new FormData();
    formData.append('receipt', receipt, 'receipt.jpg');
    formData.append('thumbnail', thumbnail, 'thumbnail.jpg');
    return apiRequest<{ receiptKey: string; receiptThumbKey: string | null }>(
      `/api/v1/settlements/${settlementId}/receipt`,
      { method: 'POST', headers: {}, body: formData },
    );
  },

  deleteSettlementReceipt: (settlementId: number) =>
    apiRequest<{ deleted: boolean }>(`/api/v1/settlements/${settlementId}/receipt`, {
      method: 'DELETE',
    }),

  // Reports
  reportImage: (imageKey: string, reason: string, details?: string) =>
    apiRequest<{ reported: boolean }>('/api/v1/reports', {
      method: 'POST',
      body: JSON.stringify({ imageKey, reason, details }),
    }),

  // Activity
  getActivity: (cursor?: string) =>
    apiRequest<{ items: ActivityItem[]; nextCursor: string | null }>(
      `/api/v1/activity${cursor ? `?cursor=${cursor}` : ''}`,
    ),

  getGroupActivity: (groupId: number, cursor?: string) =>
    apiRequest<{ items: ActivityItem[]; nextCursor: string | null }>(
      `/api/v1/groups/${groupId}/activity${cursor ? `?cursor=${cursor}` : ''}`,
    ),
};
