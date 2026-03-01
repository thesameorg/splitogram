import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Image Storage
  IMAGES: R2Bucket;

  // Environment Variables
  ENVIRONMENT: string;
  TELEGRAM_BOT_TOKEN: string;
  PAGES_URL?: string;
  DEV_AUTH_BYPASS_ENABLED?: string;

  // Admin
  ADMIN_TELEGRAM_ID?: string;

  // TON
  USDT_MASTER_ADDRESS?: string;
  TONAPI_KEY?: string;
}

export interface SessionData {
  telegramId: number;
  username?: string;
  displayName: string;
}
