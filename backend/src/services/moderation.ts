import type { R2Bucket } from '@cloudflare/workers-types';
import { eq, or } from 'drizzle-orm';
import { users, groups, expenses, settlements } from '../db/schema';
import type { Database } from '../db';

/**
 * Delete an image from R2 (main + thumbnail) and clear DB references.
 * Key format: `{prefix}/{entityId}-{hash}.jpg` where prefix is avatars|groups|receipts.
 */
export async function removeImage(bucket: R2Bucket, db: Database, imageKey: string): Promise<void> {
  await bucket.delete(imageKey);

  // Also delete thumbnail variant if exists
  const thumbKey = imageKey.replace('.jpg', '-thumb.jpg');
  await bucket.delete(thumbKey).catch(() => {});

  // Clear DB column based on key prefix
  const [prefix, entityIdStr] = imageKey.split('/');
  const entityId = parseInt(entityIdStr, 10);

  if (isNaN(entityId)) {
    console.warn('[moderation:removeImage] Could not parse entityId from key:', imageKey);
    return;
  }

  if (prefix === 'avatars') {
    await db.update(users).set({ avatarKey: null }).where(eq(users.id, entityId));
  } else if (prefix === 'groups') {
    await db.update(groups).set({ avatarKey: null }).where(eq(groups.id, entityId));
  } else if (prefix === 'receipts') {
    // Could be expense or settlement — clear both
    await db
      .update(expenses)
      .set({ receiptKey: null, receiptThumbKey: null })
      .where(or(eq(expenses.receiptKey, imageKey), eq(expenses.receiptThumbKey, imageKey)));
    await db
      .update(settlements)
      .set({ receiptKey: null, receiptThumbKey: null })
      .where(or(eq(settlements.receiptKey, imageKey), eq(settlements.receiptThumbKey, imageKey)));
  } else {
    console.warn('[moderation:removeImage] Unknown key prefix:', prefix);
  }
}
