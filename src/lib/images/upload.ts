// 10 MB max upload size per file
export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

export { ALLOWED_IMAGE_EXTENSIONS } from '@/lib/images/formats';

const IMAGE_SIGNATURES: Array<{ bytes: Buffer; format: string }> = [
  { bytes: Buffer.from([0xff, 0xd8, 0xff]), format: 'jpg' },
  { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), format: 'png' },
  { bytes: Buffer.from('GIF87a', 'ascii'), format: 'gif' },
  { bytes: Buffer.from('GIF89a', 'ascii'), format: 'gif' },
];

/**
 * Validate image content by checking magic bytes.
 * Returns true if the buffer starts with a known image signature.
 */
export function isValidImage(buffer: Buffer): boolean {
  if (buffer.length < 8) {
    return false;
  }

  return IMAGE_SIGNATURES.some(
    ({ bytes }) =>
      buffer.length >= bytes.length &&
      buffer.subarray(0, bytes.length).equals(bytes),
  );
}
