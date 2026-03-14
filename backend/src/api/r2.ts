import { Hono } from 'hono';
import type { Env } from '../env';

const COMMON_HEADERS: Record<string, string> = {
  'Cache-Control': 'public, max-age=31536000, immutable',
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

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
  if (cached) {
    // Cache API returns immutable responses — clone to allow downstream header modifications
    return new Response(cached.body, {
      status: cached.status,
      headers: new Headers(cached.headers),
    });
  }

  const object = await c.env.IMAGES.get(key);

  if (!object) {
    return c.notFound();
  }

  const headers = new Headers(COMMON_HEADERS);
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
  if (object.size) {
    headers.set('Content-Length', object.size.toString());
  }

  const response = new Response(object.body as unknown as ReadableStream, { headers });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});

export { r2App };
