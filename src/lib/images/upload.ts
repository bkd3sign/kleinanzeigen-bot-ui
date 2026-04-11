// 10 MB max upload size per file
export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

export const ALLOWED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
]);

/**
 * Magic byte signatures for common image formats.
 * Each entry maps a byte sequence (as hex) to the format name.
 */
const IMAGE_SIGNATURES: Array<{ bytes: Buffer; format: string }> = [
  { bytes: Buffer.from([0xff, 0xd8, 0xff]), format: 'jpg' },
  { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), format: 'png' },
  { bytes: Buffer.from('GIF87a', 'ascii'), format: 'gif' },
  { bytes: Buffer.from('GIF89a', 'ascii'), format: 'gif' },
  { bytes: Buffer.from('BM', 'ascii'), format: 'bmp' },
];

/**
 * Validate image content by checking magic bytes.
 * Returns true if the buffer starts with a known image signature.
 */
export function isValidImage(buffer: Buffer): boolean {
  if (buffer.length < 12) {
    return false;
  }

  // Check for WebP: starts with RIFF and has WEBP at offset 8
  const isWebp =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  const hasSignature = IMAGE_SIGNATURES.some(
    ({ bytes }) =>
      buffer.length >= bytes.length &&
      buffer.subarray(0, bytes.length).equals(bytes),
  );

  return isWebp || hasSignature;
}
