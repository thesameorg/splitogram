export const config = {
  apiBaseUrl: (import.meta.env.PROD ? import.meta.env.VITE_WORKER_URL || '' : '').replace(
    /\/+$/,
    '',
  ),
  telegramBotUsername: import.meta.env.VITE_TELEGRAM_BOT_USERNAME || '',
  tonConnectManifestUrl:
    import.meta.env.VITE_TON_CONNECT_MANIFEST_URL ||
    `${window.location.origin}/tonconnect-manifest.json`,
  tonNetwork: (import.meta.env.VITE_TON_NETWORK || 'testnet') as 'testnet' | 'mainnet',
};
