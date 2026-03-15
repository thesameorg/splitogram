/** Generate a unique R2 key with prefix, entity ID, and random suffix */
export function generateR2Key(prefix: string, entityId: number | string): string {
  const timestamp = Date.now();
  const random = crypto.getRandomValues(new Uint8Array(4));
  const hex = Array.from(random)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}/${entityId}/${timestamp}_${hex}.jpg`;
}

/** Best-effort R2 delete — log errors, never throw */
export async function safeR2Delete(bucket: { delete(key: string): Promise<void> }, key: string) {
  try {
    await bucket.delete(key);
  } catch (e) {
    console.error('R2 cleanup failed:', key, e);
  }
}

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5 MB server limit
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Validate an uploaded image file. Returns error string or null. */
export function validateUpload(file: File | { size: number; type: string }): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return 'Invalid file type. Accepted: JPEG, PNG, WebP.';
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    return 'File too large. Maximum 5 MB.';
  }
  return null;
}

/** Upload receipt + optional thumbnail to R2. Returns keys or error string. */
export async function uploadReceiptPair(
  bucket: { put(key: string, value: ArrayBuffer, options?: any): Promise<any> },
  entityId: number,
  body: Record<string, unknown>,
): Promise<{ receiptKey: string; thumbKey: string | null } | { error: string }> {
  const receipt = body['receipt'];
  const thumbnail = body['thumbnail'];

  if (!(receipt instanceof File)) {
    return { error: 'No receipt file provided' };
  }

  const validationError = validateUpload(receipt);
  if (validationError) {
    return { error: validationError };
  }

  const receiptKey = generateR2Key('receipts', entityId);
  await bucket.put(receiptKey, await receipt.arrayBuffer(), {
    httpMetadata: { contentType: receipt.type },
  });

  let thumbKey: string | null = null;
  if (thumbnail instanceof File) {
    const thumbError = validateUpload(thumbnail);
    if (!thumbError) {
      thumbKey = receiptKey.replace('.jpg', '-thumb.jpg');
      await bucket.put(thumbKey, await thumbnail.arrayBuffer(), {
        httpMetadata: { contentType: thumbnail.type },
      });
    }
  }

  return { receiptKey, thumbKey };
}
