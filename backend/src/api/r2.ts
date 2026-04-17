import { Hono } from 'hono';
import type { Env } from '../env';
import { IMAGE_DENYLIST_PREFIX } from '../services/moderation';

const COMMON_HEADERS: Record<string, string> = {
  'Cache-Control': 'public, max-age=31536000, immutable',
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

const PLACEHOLDER_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" preserveAspectRatio="xMidYMid meet">
  <rect width="240" height="240" fill="#e5e7eb"/>
  <g transform="translate(120,105)" stroke="#9ca3af" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <rect x="-36" y="-28" width="72" height="56" rx="6"/>
    <circle cx="-14" cy="-10" r="6"/>
    <path d="M-36 16 L-10 -6 L14 12 L36 -4"/>
  </g>
  <line x1="60" y1="60" x2="180" y2="180" stroke="#ef4444" stroke-width="4" stroke-linecap="round"/>
  <text x="120" y="198" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="16" fill="#6b7280">Image removed by admin</text>
</svg>`;

const PLACEHOLDER_HEADERS: Record<string, string> = {
  'Content-Type': 'image/svg+xml; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
};

const r2App = new Hono<{ Bindings: Env }>();

// GET /r2/:key+ — serve images from R2 with edge + browser caching
r2App.get('/*', async (c) => {
  const key = c.req.path.replace(/^\/r2\//, '');

  if (!key) {
    return c.json({ error: 'missing_key', detail: 'No image key provided' }, 400);
  }

  // Denylist check runs first so admin takedowns are effective across all colos.
  // KV is cached at the edge (~60s) so this is cheap on the hot path.
  if (c.env.KV) {
    const denied = await c.env.KV.get(`${IMAGE_DENYLIST_PREFIX}${key}`);
    if (denied) {
      return new Response(PLACEHOLDER_SVG, {
        status: 200,
        headers: new Headers(PLACEHOLDER_HEADERS),
      });
    }
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
    return new Response(PLACEHOLDER_SVG, {
      status: 200,
      headers: new Headers(PLACEHOLDER_HEADERS),
    });
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
