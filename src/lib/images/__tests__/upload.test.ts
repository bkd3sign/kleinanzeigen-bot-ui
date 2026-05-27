import { describe, it, expect } from 'vitest';
import { ALLOWED_IMAGE_EXTENSIONS, MAX_UPLOAD_SIZE, isValidImage } from '../upload';

describe('ALLOWED_IMAGE_EXTENSIONS', () => {
  it('contains exactly the formats the bot accepts', () => {
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.jpg')).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.jpeg')).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.png')).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.gif')).toBe(true);
  });

  it('does not contain formats the bot rejects', () => {
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.webp')).toBe(false);
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.bmp')).toBe(false);
  });

  it('does not contain dangerous extensions', () => {
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.exe')).toBe(false);
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.js')).toBe(false);
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.html')).toBe(false);
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.svg')).toBe(false);
  });
});

describe('MAX_UPLOAD_SIZE', () => {
  it('is 10MB', () => {
    expect(MAX_UPLOAD_SIZE).toBe(10 * 1024 * 1024);
  });
});

describe('isValidImage', () => {
  it('rejects empty buffer', () => {
    expect(isValidImage(Buffer.alloc(0))).toBe(false);
  });

  it('rejects too-small buffer (less than 8 bytes)', () => {
    expect(isValidImage(Buffer.alloc(5))).toBe(false);
    expect(isValidImage(Buffer.alloc(7))).toBe(false);
  });

  it('rejects random data', () => {
    const random = Buffer.alloc(100, 0x00);
    expect(isValidImage(random)).toBe(false);
  });

  it('accepts valid JPEG magic bytes', () => {
    const jpegBuffer = Buffer.alloc(100);
    jpegBuffer[0] = 0xff;
    jpegBuffer[1] = 0xd8;
    jpegBuffer[2] = 0xff;
    expect(isValidImage(jpegBuffer)).toBe(true);
  });

  it('accepts valid PNG magic bytes', () => {
    const pngBuffer = Buffer.alloc(100);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(pngBuffer);
    expect(isValidImage(pngBuffer)).toBe(true);
  });

  it('accepts valid GIF87a magic bytes', () => {
    const gifBuffer = Buffer.alloc(100);
    Buffer.from('GIF87a', 'ascii').copy(gifBuffer);
    expect(isValidImage(gifBuffer)).toBe(true);
  });

  it('accepts valid GIF89a magic bytes', () => {
    const gifBuffer = Buffer.alloc(100);
    Buffer.from('GIF89a', 'ascii').copy(gifBuffer);
    expect(isValidImage(gifBuffer)).toBe(true);
  });

  it('rejects WebP (not supported by bot)', () => {
    const webpBuffer = Buffer.alloc(100);
    Buffer.from('RIFF', 'ascii').copy(webpBuffer, 0);
    Buffer.from('WEBP', 'ascii').copy(webpBuffer, 8);
    expect(isValidImage(webpBuffer)).toBe(false);
  });

  it('rejects BMP (not supported by bot)', () => {
    const bmpBuffer = Buffer.alloc(100);
    Buffer.from('BM', 'ascii').copy(bmpBuffer);
    expect(isValidImage(bmpBuffer)).toBe(false);
  });

  it('rejects text content disguised as image', () => {
    const textBuffer = Buffer.from('<html>malicious content</html>' + '\0'.repeat(100));
    expect(isValidImage(textBuffer)).toBe(false);
  });
});
