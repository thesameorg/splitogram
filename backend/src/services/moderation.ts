import type { R2Bucket } from '@cloudflare/workers-types';

/**
 * Delete an image (main + thumbnail) from R2. DB references are left intact
 * so that the /r2/* endpoint returns a "removed by admin" placeholder next
 * time the frontend requests the URL.
 *
 * Key format: `{prefix}/{entityId}/{timestamp}_{hash}.jpg` where prefix is
 * avatars | groups | receipts | comments. Thumbnails end with `-thumb.jpg`.
 */
export async function removeImage(bucket: R2Bucket, imageKey: string): Promise<void> {
  try {
    await bucket.delete(imageKey);
  } catch (e) {
    console.error('[moderation:removeImage] R2 delete failed:', imageKey, e);
  }

  if (!imageKey.endsWith('-thumb.jpg')) {
    const thumbKey = imageKey.replace(/\.jpg$/, '-thumb.jpg');
    await bucket.delete(thumbKey).catch(() => {});
  }
}
