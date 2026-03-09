import type { D1Database, R2Bucket, KVNamespace } from '@cloudflare/workers-types';

export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Image Storage
  IMAGES: R2Bucket;

  // KV Namespace
  KV: KVNamespace;

  // Environment Variables
  ENVIRONMENT: string;
  TELEGRAM_BOT_TOKEN: string;
  PAGES_URL?: string;
  DEV_AUTH_BYPASS_ENABLED?: string;

  // Admin
  ADMIN_TELEGRAM_ID?: string;
  ADMIN_SECRET?: string;

  // TON
  USDT_MASTER_ADDRESS?: string;
  SETTLEMENT_CONTRACT_ADDRESS?: string;
  TON_NETWORK?: string; // 'testnet' | 'mainnet'
  TONAPI_KEY?: string;
}

export interface SessionData {
  telegramId: number;
  userId: number;
}
