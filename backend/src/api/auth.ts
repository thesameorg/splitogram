import { Context } from "hono";
import { TelegramAuthService } from "../services/telegram-auth";
import { SessionManager } from "../services/session-manager";
import { createDatabase } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { mockUser as devMockUser } from "../dev/mock-user";
import type { Env } from "../env";

export async function authHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const sessionManager = new SessionManager(c.env.SESSIONS);

  // DEV-ONLY: Auth bypass for local development
  if (c.env.DEV_AUTH_BYPASS_ENABLED === "true") {
    const db = createDatabase(c.env.DB);

    // Upsert dev user into DB
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, devMockUser.id))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(users).values({
        telegramId: devMockUser.id,
        username: devMockUser.username ?? null,
        displayName: `${devMockUser.first_name} ${devMockUser.last_name ?? ""}`.trim(),
      });
    }

    const session = await sessionManager.createSession(devMockUser);

    return c.json({
      authenticated: true,
      sessionId: session.sessionId,
      user: {
        id: devMockUser.id,
        first_name: devMockUser.first_name,
        last_name: devMockUser.last_name,
        username: devMockUser.username,
      },
      expiresAt: session.expiresAt,
      source: "dev_bypass",
    });
  }

  let body: Record<string, unknown> = {};
  try {
    const rawBody = await c.req.text();
    body = JSON.parse(rawBody);
  } catch {
    // Continue with empty body
  }

  const { sessionId, initData } = body;
  const authHeader = c.req.header("Authorization");
  const sessionIdHeader = c.req.header("X-Session-ID");

  const finalSessionId = (sessionId ?? sessionIdHeader) as string | undefined;
  const initDataParam = initData as string | undefined;

  const telegramAuth = new TelegramAuthService(c.env.TELEGRAM_BOT_TOKEN);

  // Try session validation first
  if (finalSessionId) {
    const session = await sessionManager.validateSession(finalSessionId);
    if (session) {
      return c.json({
        authenticated: true,
        sessionId: session.sessionId,
        user: {
          id: session.telegramId,
          username: session.username,
          displayName: session.displayName,
        },
        expiresAt: session.expiresAt,
        source: "session",
      });
    }
  }

  // Fall back to initData validation
  const extractedInitData = telegramAuth.extractInitData(
    authHeader,
    initDataParam,
  );

  if (!extractedInitData) {
    return c.json(
      {
        error: "auth_required",
        detail: finalSessionId
          ? "Session expired, please re-authenticate"
          : "Authentication required",
      },
      401,
    );
  }

  try {
    const tgUser = await telegramAuth.validateInitData(extractedInitData);

    // Upsert user into DB
    const db = createDatabase(c.env.DB);
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, tgUser.id))
      .limit(1);

    const displayName = tgUser.last_name
      ? `${tgUser.first_name} ${tgUser.last_name}`.trim()
      : tgUser.first_name;

    if (existing.length === 0) {
      await db.insert(users).values({
        telegramId: tgUser.id,
        username: tgUser.username ?? null,
        displayName,
      });
    } else {
      await db
        .update(users)
        .set({
          username: tgUser.username ?? null,
          displayName,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.telegramId, tgUser.id));
    }

    const session = await sessionManager.createSession(tgUser);

    return c.json({
      authenticated: true,
      sessionId: session.sessionId,
      user: {
        id: tgUser.id,
        first_name: tgUser.first_name,
        last_name: tgUser.last_name,
        username: tgUser.username,
      },
      expiresAt: session.expiresAt,
      source: "initdata",
    });
  } catch (error) {
    return c.json(
      {
        error: "invalid_init_data",
        detail:
          error instanceof Error
            ? error.message
            : "Invalid Telegram authentication",
      },
      401,
    );
  }
}
