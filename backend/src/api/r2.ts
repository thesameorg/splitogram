import { Hono } from 'hono';
import type { Env } from '../env';

const r2App = new Hono<{ Bindings: Env }>();

// GET /r2/:key+ — serve images from R2 with edge + browser caching
r2App.get('/*', async (c) => {
  const key = c.req.path.replace(/^\/r2\//, '');

  if (!key) {
    return c.json({ error: 'missing_key', detail: 'No image key provided' }, 400);
  }

  // Check Cloudflare edge cache first (avoids R2 read on cache hit)
  const cacheKey = new Request(c.req.url);
  const cache = (caches as any).default as Cache;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const object = await c.env.IMAGES.get(key);

  if (!object) {
    return c.notFound();
  }

  const headers = new Headers();
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
  headers.set('Access-Control-Allow-Origin', '*');
  if (object.size) {
    headers.set('Content-Length', object.size.toString());
  }

  const response = new Response(object.body as unknown as ReadableStream, { headers });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});

export { r2App };
