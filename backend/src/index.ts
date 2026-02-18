import { Hono } from 'hono';
import { prettyJSON } from 'hono/pretty-json';
import { cors } from 'hono/cors';
import { handleWebhook } from './webhook';
import { healthHandler } from './api/health';
import { authHandler } from './api/auth';
import { groupsApp } from './api/groups';
import { expensesApp } from './api/expenses';
import { balancesApp } from './api/balances';
import { settlementsApp } from './api/settlements';
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

// --- Protected endpoints ---
// Groups
app.use('/api/v1/groups/*', authMiddleware);
app.route('/api/v1/groups', groupsApp);

// Expenses (nested under groups)
app.use('/api/v1/groups/:id/expenses/*', authMiddleware);
app.route('/api/v1/groups/:id/expenses', expensesApp);

// Balances (nested under groups)
app.use('/api/v1/groups/:id/balances/*', authMiddleware);
app.route('/api/v1/groups/:id/balances', balancesApp);

// Settlements & Wallet (mixed routes)
app.use('/api/v1/settlements/*', authMiddleware);
app.use('/api/v1/users/*', authMiddleware);
app.route('/api/v1', settlementsApp);

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
