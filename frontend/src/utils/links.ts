/**
 * Opens a URL in Telegram's built-in browser (Instant View when possible).
 * Falls back to window.open for non-Telegram environments.
 */
export function openExternalLink(url: string, e?: React.MouseEvent) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const webApp = window.Telegram?.WebApp;
  if (webApp?.openLink) {
    webApp.openLink(url, { try_instant_view: true });
  } else {
    window.open(url, '_blank');
  }
}
