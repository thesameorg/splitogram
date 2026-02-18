import { Context, Next } from "hono";
import { SessionManager } from "../services/session-manager";
import { mockUser } from "../dev/mock-user";
import type { Env, SessionData } from "../env";

export type AuthContext = {
  Bindings: Env;
  Variables: {
    session: SessionData;
  };
};

function extractSessionId(c: Context): string | null {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  const sessionIdHeader = c.req.header("X-Session-ID");
  if (sessionIdHeader) {
    return sessionIdHeader;
  }

  return null;
}

export async function authMiddleware(c: Context<AuthContext>, next: Next) {
  const sessionManager = new SessionManager(c.env.SESSIONS);

  // DEV MODE: Auto-create session if bypass enabled and no session exists
  if (c.env.DEV_AUTH_BYPASS_ENABLED === "true") {
    const sessionId = extractSessionId(c);
    if (!sessionId) {
      const devSession = await sessionManager.createSession(mockUser);
      c.set("session", devSession);
      await next();
      return;
    }
  }

  const sessionId = extractSessionId(c);
  if (!sessionId) {
    return c.json({ error: "auth_required", detail: "Authentication required" }, 401);
  }

  const session = await sessionManager.validateSession(sessionId);
  if (!session) {
    return c.json({ error: "invalid_session", detail: "Invalid or expired session" }, 401);
  }

  c.set("session", session);
  await next();
}
