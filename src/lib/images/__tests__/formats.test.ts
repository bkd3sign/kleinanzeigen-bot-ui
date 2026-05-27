import { describe, it, expect } from 'vitest';
import { ALLOWED_IMAGE_EXTENSIONS, allowedFormatsLabel, filterImageFiles } from '../formats';

describe('ALLOWED_IMAGE_EXTENSIONS', () => {
  it('contains exactly the four bot-supported formats', () => {
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.jpg')).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.jpeg')).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.png')).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.gif')).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.size).toBe(4);
  });

  it('rejects unsupported formats', () => {
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.webp')).toBe(false);
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.bmp')).toBe(false);
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.pdf')).toBe(false);
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.svg')).toBe(false);
    expect(ALLOWED_IMAGE_EXTENSIONS.has('.heic')).toBe(false);
  });
});

describe('allowedFormatsLabel', () => {
  it('returns uppercase format names joined by comma', () => {
    const label = allowedFormatsLabel();
    expect(label).toContain('JPG');
    expect(label).toContain('PNG');
    expect(label).toContain('GIF');
    expect(label).toContain('JPEG');
  });

  it('does not contain leading dots', () => {
    expect(allowedFormatsLabel()).not.toContain('.');
  });
});

describe('filterImageFiles', () => {
  const makeFile = (name: string) => new File([], name);

  it('accepts supported formats', () => {
    const files = [makeFile('foto.jpg'), makeFile('bild.jpeg'), makeFile('img.png'), makeFile('anim.gif')];
    const { accepted, rejected } = filterImageFiles(files);
    expect(accepted).toHaveLength(4);
    expect(rejected).toHaveLength(0);
  });

  it('rejects unsupported formats and returns their names', () => {
    const files = [makeFile('doc.pdf'), makeFile('image.webp'), makeFile('photo.heic')];
    const { accepted, rejected } = filterImageFiles(files);
    expect(accepted).toHaveLength(0);
    expect(rejected).toEqual(['doc.pdf', 'image.webp', 'photo.heic']);
  });

  it('splits mixed input into accepted and rejected', () => {
    const files = [makeFile('good.jpg'), makeFile('bad.pdf'), makeFile('also-good.png')];
    const { accepted, rejected } = filterImageFiles(files);
    expect(accepted.map(f => f.name)).toEqual(['good.jpg', 'also-good.png']);
    expect(rejected).toEqual(['bad.pdf']);
  });

  it('extension check is case-insensitive', () => {
    const files = [makeFile('FOTO.JPG'), makeFile('bild.PNG'), makeFile('img.Gif')];
    const { accepted, rejected } = filterImageFiles(files);
    expect(accepted).toHaveLength(3);
    expect(rejected).toHaveLength(0);
  });

  it('rejects files without extension', () => {
    const { accepted, rejected } = filterImageFiles([makeFile('keinext')]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toEqual(['keinext']);
  });

  it('handles empty input', () => {
    const { accepted, rejected } = filterImageFiles([]);
    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });

  it('preserves File object identity in accepted list', () => {
    const file = makeFile('foto.jpg');
    const { accepted } = filterImageFiles([file]);
    expect(accepted[0]).toBe(file);
  });
});
