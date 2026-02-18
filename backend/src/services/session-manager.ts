import type { SessionData, Env } from '../env';
import type { TelegramUser } from '../models/telegram-user';
import { getDisplayName } from '../models/telegram-user';

export class SessionManager {
  private readonly kv: KVNamespace;
  private readonly sessionTTL: number;

  constructor(kv: KVNamespace, sessionTTL: number = 3600) {
    this.kv = kv;
    this.sessionTTL = sessionTTL;
  }

  async createSession(user: TelegramUser): Promise<SessionData> {
    const sessionId = crypto.randomUUID();
    const now = Date.now();

    const sessionData: SessionData = {
      sessionId,
      telegramId: user.id,
      username: user.username,
      displayName: getDisplayName(user),
      createdAt: now,
      expiresAt: now + this.sessionTTL * 1000,
    };

    await this.kv.put(`session:${sessionId}`, JSON.stringify(sessionData), {
      expirationTtl: this.sessionTTL,
    });

    return sessionData;
  }

  async validateSession(sessionId: string): Promise<SessionData | null> {
    if (!sessionId) return null;

    const raw = await this.kv.get(`session:${sessionId}`);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as SessionData;
    } catch {
      await this.kv.delete(`session:${sessionId}`);
      return null;
    }
  }

  async refreshSession(sessionId: string): Promise<SessionData | null> {
    const session = await this.validateSession(sessionId);
    if (!session) return null;

    const updated: SessionData = {
      ...session,
      expiresAt: Date.now() + this.sessionTTL * 1000,
    };

    await this.kv.put(`session:${sessionId}`, JSON.stringify(updated), {
      expirationTtl: this.sessionTTL,
    });

    return updated;
  }

  static create(env: Env, sessionTTL?: number): SessionManager {
    return new SessionManager(env.SESSIONS, sessionTTL);
  }
}
