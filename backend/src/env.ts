import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  // KV Namespaces
  SESSIONS: KVNamespace;

  // D1 Database
  DB: D1Database;

  // Environment Variables
  ENVIRONMENT: string;
  TELEGRAM_BOT_TOKEN: string;
  PAGES_URL?: string;
  DEV_AUTH_BYPASS_ENABLED?: string;

  // TON
  USDT_MASTER_ADDRESS?: string;
  TONAPI_KEY?: string;
}

export interface SessionData {
  sessionId: string;
  telegramId: number;
  username?: string;
  displayName: string;
  createdAt: number;
  expiresAt: number;
}
