import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types';

export const IMAGE_DENYLIST_PREFIX = 'deleted-image:';
// 30 days — long enough that stale edge caches (max-age=1y, but they get evicted
// earlier under memory pressure) won't outlive the denylist entry for any realistic case.
const IMAGE_DENYLIST_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Delete an image (main + thumbnail) from R2 AND mark it as taken-down.
 *
 * The KV denylist entry is the load-bearing piece here: `caches.default.delete()`
 * only affects the Worker's local colo, so users in other regions would keep
 * seeing the cached image. /r2/* reads KV first and short-circuits to the
 * placeholder when the key is denylisted. KV propagates globally within ~60s.
 *
 * `cacheOrigin` (optional) lets us also purge the current colo's cache
 * immediately so the admin sees the result in their own region without waiting
 * for KV fanout. Best-effort.
 *
 * Key format: `{prefix}/{entityId}/{timestamp}_{hash}.jpg` where prefix is
 * avatars | groups | receipts | comments. Thumbnails end with `-thumb.jpg`.
 */
export async function removeImage(
  bucket: R2Bucket,
  imageKey: string,
  opts: { cacheOrigin?: string; kv?: KVNamespace } = {},
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

  if (opts.kv) {
    try {
      await opts.kv.put(`${IMAGE_DENYLIST_PREFIX}${imageKey}`, '1', {
        expirationTtl: IMAGE_DENYLIST_TTL_SECONDS,
      });
      if (thumbKey) {
        await opts.kv.put(`${IMAGE_DENYLIST_PREFIX}${thumbKey}`, '1', {
          expirationTtl: IMAGE_DENYLIST_TTL_SECONDS,
        });
      }
    } catch (e) {
      console.error('[moderation:removeImage] KV denylist write failed:', imageKey, e);
    }
  }

  if (opts.cacheOrigin) {
    try {
      const cache = (caches as unknown as { default: Cache }).default;
      await cache.delete(new Request(`${opts.cacheOrigin}/r2/${imageKey}`));
      if (thumbKey) {
        await cache.delete(new Request(`${opts.cacheOrigin}/r2/${thumbKey}`));
      }
    } catch (e) {
      console.error('[moderation:removeImage] Edge cache purge failed:', imageKey, e);
    }
  }
}
