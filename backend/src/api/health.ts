import { Context } from 'hono';

export async function healthHandler(c: Context) {
  return c.json(
    {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: c.env.ENVIRONMENT ?? 'local',
      version: '0.1.0',
    },
    200,
    {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  );
}
