import type { R2Bucket } from '@cloudflare/workers-types';

/**
 * Delete an image (main + thumbnail) from R2 AND purge Cloudflare edge cache.
 *
 * Without the cache purge, /r2/{key} responses remain in the CF edge cache
 * with max-age=31536000 even after R2 is empty, so users keep seeing the
 * "deleted" image until the edge entry evicts. `cacheOrigin` is the worker
 * origin (e.g. https://splitogram-worker.dksg.qzz.io) used to reconstruct
 * the exact cache key that /r2/* set via `cache.put()`.
 *
 * Key format: `{prefix}/{entityId}/{timestamp}_{hash}.jpg` where prefix is
 * avatars | groups | receipts | comments. Thumbnails end with `-thumb.jpg`.
 */
export async function removeImage(
  bucket: R2Bucket,
  imageKey: string,
  cacheOrigin?: string,
): Promise<void> {
  const thumbKey = imageKey.endsWith('-thumb.jpg')
    ? null
    : imageKey.replace(/\.jpg$/, '-thumb.jpg');

  try {
    await bucket.delete(imageKey);
  } catch (e) {
    console.error('[moderation:removeImage] R2 delete failed:', imageKey, e);
  }

  if (thumbKey) {
    await bucket.delete(thumbKey).catch(() => {});
  }

  if (cacheOrigin) {
    try {
      const cache = (caches as unknown as { default: Cache }).default;
      await cache.delete(new Request(`${cacheOrigin}/r2/${imageKey}`));
      if (thumbKey) {
        await cache.delete(new Request(`${cacheOrigin}/r2/${thumbKey}`));
      }
    } catch (e) {
      console.error('[moderation:removeImage] Edge cache purge failed:', imageKey, e);
    }
  }
}
