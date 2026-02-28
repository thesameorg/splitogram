import { config } from '../config';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_INPUT_SIZE = 20 * 1024 * 1024; // 20 MB raw input

export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
}

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return 'Invalid file type. Please use JPG, PNG, or WebP.';
  }
  if (file.size > MAX_INPUT_SIZE) {
    return 'File too large. Maximum size is 20 MB.';
  }
  return null;
}

async function processImage(
  file: File,
  maxDimension: number,
  quality: number,
): Promise<ProcessedImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  // Calculate target dimensions maintaining aspect ratio
  let targetWidth = width;
  let targetHeight = height;

  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      targetWidth = maxDimension;
      targetHeight = Math.round((height / width) * maxDimension);
    } else {
      targetHeight = maxDimension;
      targetWidth = Math.round((width / height) * maxDimension);
    }
  }

  // Draw to canvas (strips EXIF, applies orientation)
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  // Export as JPEG
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
      'image/jpeg',
      quality,
    );
  });

  return { blob, width: targetWidth, height: targetHeight };
}

/** Process image for user/group avatar: 256px max, 0.80 quality */
export function processAvatar(file: File): Promise<ProcessedImage> {
  return processImage(file, 256, 0.8);
}

/** Process full receipt image: 1200px max, 0.85 quality */
export function processReceipt(file: File): Promise<ProcessedImage> {
  return processImage(file, 1200, 0.85);
}

/** Process receipt thumbnail: 200px max, 0.75 quality */
export function processReceiptThumbnail(file: File): Promise<ProcessedImage> {
  return processImage(file, 200, 0.75);
}

/** Build the R2 image URL for display — points to Worker origin in production */
export function imageUrl(key: string): string {
  return `${config.apiBaseUrl}/r2/${key}`;
}
