import { Hono } from 'hono';
import type { Env } from '../env';

const r2App = new Hono<{ Bindings: Env }>();

// GET /r2/:key+ — serve images from R2 with immutable caching
r2App.get('/*', async (c) => {
  const key = c.req.path.replace(/^\/r2\//, '');

  if (!key) {
    return c.json({ error: 'missing_key', detail: 'No image key provided' }, 400);
  }

  const object = await c.env.IMAGES.get(key);

  if (!object) {
    return c.notFound();
  }

  const headers = new Headers();
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
  if (object.size) {
    headers.set('Content-Length', object.size.toString());
  }

  return new Response(object.body as unknown as ReadableStream, { headers });
});

export { r2App };
