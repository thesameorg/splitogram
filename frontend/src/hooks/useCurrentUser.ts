import type { GroupMember } from '../services/api';

interface CurrentUser {
  userId: number;
  telegramId: number;
  displayName: string;
  role: string;
  joinedAt: string;
}

/**
 * Determine the current user from group members list.
 * Uses TG WebApp user ID, falls back to first admin in dev mode.
 */
export function resolveCurrentUser(members: GroupMember[]): CurrentUser | null {
  const webApp = window.Telegram?.WebApp;
  const tgId = webApp?.initDataUnsafe?.user?.id;

  if (tgId) {
    const member = members.find((m) => m.telegramId === tgId);
    if (member) {
      return {
        userId: member.userId,
        telegramId: member.telegramId,
        displayName: member.displayName,
        role: member.role,
        joinedAt: member.joinedAt,
      };
    }
  }

  // Dev mode — assume first admin is current user
  const admin = members.find((m) => m.role === 'admin');
  if (admin) {
    return {
      userId: admin.userId,
      telegramId: admin.telegramId,
      displayName: admin.displayName,
      role: admin.role,
      joinedAt: admin.joinedAt,
    };
  }

  return null;
}
