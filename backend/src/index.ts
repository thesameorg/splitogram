import { Hono } from 'hono';
import { prettyJSON } from 'hono/pretty-json';
import { cors } from 'hono/cors';
import { handleWebhook } from './webhook';
import { healthHandler } from './api/health';
import { authHandler } from './api/auth';
import { authMiddleware } from './middleware/auth';
import { dbMiddleware } from './middleware/db';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use('*', prettyJSON());
app.use('*', dbMiddleware);

// CORS for API endpoints
app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      const pagesUrl = c.env.PAGES_URL;
      if (!pagesUrl) {
        return origin || '*';
      }
      const allowed = [pagesUrl, 'https://t.me'];
      if (origin && allowed.some((a) => origin.startsWith(a))) {
        return origin;
      }
      return allowed[0];
    },
    credentials: true,
  }),
);

// --- Public endpoints ---
app.get('/api/health', healthHandler);
app.post('/webhook', handleWebhook);
app.post('/api/v1/auth', authHandler);

// --- Protected endpoints (stubs — to be implemented per task group) ---
// Groups
// app.get("/api/v1/groups", authMiddleware, ...)
// app.post("/api/v1/groups", authMiddleware, ...)
// app.get("/api/v1/groups/:id", authMiddleware, ...)
// app.get("/api/v1/groups/join/:inviteCode", ...)
// app.post("/api/v1/groups/:id/join", authMiddleware, ...)

// Expenses
// app.post("/api/v1/groups/:id/expenses", authMiddleware, ...)
// app.get("/api/v1/groups/:id/expenses", authMiddleware, ...)

// Balances
// app.get("/api/v1/groups/:id/balances", authMiddleware, ...)

// Settlements
// app.post("/api/v1/groups/:id/settlements", authMiddleware, ...)
// app.get("/api/v1/settlements/:id/tx", authMiddleware, ...)
// app.post("/api/v1/settlements/:id/verify", authMiddleware, ...)

// User
// app.put("/api/v1/users/me/wallet", authMiddleware, ...)

// --- Root info ---
app.get('/', (c) => {
  return c.json({
    app: 'Splitogram API',
    version: '0.1.0',
    environment: c.env.ENVIRONMENT ?? 'local',
    timestamp: new Date().toISOString(),
  });
});

app.notFound((c) => {
  return c.json({ error: 'not_found', detail: 'The requested endpoint does not exist' }, 404);
});

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'internal_error', detail: 'Something went wrong' }, 500);
});

export default app;
