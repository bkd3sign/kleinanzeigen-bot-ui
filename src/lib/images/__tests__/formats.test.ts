import { describe, it, expect } from 'vitest';
import {
  ALLOWED_IMAGE_EXTENSIONS,
  allowedFormatsLabel,
  filterImageFiles,
  applyImageLimits,
  adImageCapMessage,
  formatRejectMessage,
  MAX_AD_IMAGES,
} from '../formats';

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

describe('applyImageLimits', () => {
  const makeFile = (name: string) => new File([], name);

  it('accepts valid images that fit within the remaining room', () => {
    const result = applyImageLimits([makeFile('a.jpg'), makeFile('b.png')], 0);
    expect(result.toAdd).toHaveLength(2);
    expect(result.rejectedFormat).toHaveLength(0);
    expect(result.capExceeded).toBe(false);
  });

  it('reports unsupported formats separately without affecting the cap', () => {
    const result = applyImageLimits([makeFile('a.jpg'), makeFile('b.pdf')], 0);
    expect(result.toAdd.map((f) => f.name)).toEqual(['a.jpg']);
    expect(result.rejectedFormat).toEqual(['b.pdf']);
    expect(result.capExceeded).toBe(false);
  });

  it('caps accepted files at the remaining room and flags capExceeded', () => {
    const files = [makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')];
    const result = applyImageLimits(files, MAX_AD_IMAGES - 1); // room = 1
    expect(result.toAdd).toHaveLength(1);
    expect(result.capExceeded).toBe(true);
  });

  it('adds nothing when the ad is already at the limit', () => {
    const result = applyImageLimits([makeFile('a.jpg')], MAX_AD_IMAGES);
    expect(result.toAdd).toHaveLength(0);
    expect(result.capExceeded).toBe(true);
  });

  it('does not flag capExceeded when everything fits', () => {
    const result = applyImageLimits([makeFile('a.jpg')], MAX_AD_IMAGES - 5);
    expect(result.toAdd).toHaveLength(1);
    expect(result.capExceeded).toBe(false);
  });

  it('treats an over-full count as zero room (never negative)', () => {
    const result = applyImageLimits([makeFile('a.jpg')], MAX_AD_IMAGES + 3);
    expect(result.toAdd).toHaveLength(0);
    expect(result.capExceeded).toBe(true);
  });

  it('handles empty input', () => {
    const result = applyImageLimits([], 0);
    expect(result.toAdd).toHaveLength(0);
    expect(result.rejectedFormat).toHaveLength(0);
    expect(result.capExceeded).toBe(false);
  });
});

describe('image toast messages', () => {
  it('adImageCapMessage embeds the limit', () => {
    expect(adImageCapMessage()).toBe(`Maximal ${MAX_AD_IMAGES} Bilder pro Anzeige.`);
  });

  it('formatRejectMessage lists the rejected names and allowed formats', () => {
    const msg = formatRejectMessage(['x.pdf', 'y.webp']);
    expect(msg).toContain('x.pdf');
    expect(msg).toContain('y.webp');
    expect(msg).toContain(allowedFormatsLabel());
  });
});
