export const config = {
  apiBaseUrl: import.meta.env.PROD
    ? import.meta.env.VITE_WORKER_URL || ""
    : "",
  telegramBotUsername:
    import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "",
};
