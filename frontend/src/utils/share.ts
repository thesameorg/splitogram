import { config } from '../config';

export function shareInviteLink(inviteCode: string, groupName: string, memberCount?: number): void {
  const botUsername = config.telegramBotUsername;
  const link = botUsername
    ? `https://t.me/${botUsername}?start=join_${inviteCode}`
    : `Invite code: ${inviteCode}`;

  const webApp = window.Telegram?.WebApp;
  if (webApp?.openTelegramLink) {
    const memberInfo =
      memberCount && memberCount > 1 ? `\n${memberCount} people already splitting` : '';
    const text = encodeURIComponent(
      `Join "${groupName}" on Splitogram — split expenses & settle up instantly 💸${memberInfo}`,
    );
    webApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`);
  } else {
    navigator.clipboard.writeText(link);
  }
}

export function sharePersonalizedInviteLink(
  inviteCode: string,
  placeholderId: number,
  groupName: string,
  placeholderName: string,
): void {
  const botUsername = config.telegramBotUsername;
  const link = botUsername
    ? `https://t.me/${botUsername}?start=jp_${inviteCode}_${placeholderId}`
    : `Invite code: ${inviteCode}`;

  const webApp = window.Telegram?.WebApp;
  if (webApp?.openTelegramLink) {
    const text = encodeURIComponent(
      `Join "${groupName}" on Splitogram as ${placeholderName} — your expenses are already tracked!`,
    );
    webApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`);
  } else {
    navigator.clipboard.writeText(link);
  }
}
