import { config } from '../config';

export function shareInviteLink(inviteCode: string, groupName: string): void {
  const botUsername = config.telegramBotUsername;
  const link = botUsername
    ? `https://t.me/${botUsername}?start=join_${inviteCode}`
    : `Invite code: ${inviteCode}`;

  const webApp = window.Telegram?.WebApp;
  if (webApp?.openTelegramLink) {
    const text = encodeURIComponent(`Join "${groupName}" on Splitogram! ${link}`);
    webApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`);
  } else {
    navigator.clipboard.writeText(link);
  }
}
