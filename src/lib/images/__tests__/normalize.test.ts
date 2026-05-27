import { describe, it, expect } from 'vitest';
import { toNFC, sanitizeUploadFilename } from '../normalize';

// NFD form of "ä": a (U+0061) + combining diaeresis (U+0308)
const NFD_AE = 'ä';
// NFC form of "ä": single precomposed char (U+00E4)
const NFC_AE = 'ä';

describe('toNFC', () => {
  it('normalizes NFD to NFC', () => {
    expect(toNFC(`Anh${NFD_AE}nger`)).toBe(`Anh${NFC_AE}nger`);
  });

  it('is idempotent: NFC in → NFC out', () => {
    const nfc = `Anh${NFC_AE}nger`;
    expect(toNFC(nfc)).toBe(nfc);
  });

  it('passes ASCII through unchanged', () => {
    expect(toNFC('hello/world.jpg')).toBe('hello/world.jpg');
  });
});

describe('sanitizeUploadFilename', () => {
  it('preserves German umlauts', () => {
    expect(sanitizeUploadFilename(`Anh${NFC_AE}nger.jpg`)).toBe(`Anh${NFC_AE}nger.jpg`);
  });

  it('normalizes NFD umlauts to NFC', () => {
    expect(sanitizeUploadFilename(`Anh${NFD_AE}nger.jpg`)).toBe(`Anh${NFC_AE}nger.jpg`);
  });

  it('converts spaces to underscores', () => {
    expect(sanitizeUploadFilename('Schöne Jacke.jpg')).toBe('Schöne_Jacke.jpg');
  });

  it('collapses multiple spaces to single underscore', () => {
    expect(sanitizeUploadFilename('foo  bar.jpg')).toBe('foo_bar.jpg');
  });

  it('removes path-dangerous characters', () => {
    expect(sanitizeUploadFilename('a/b\\c:d*e?f"g<h>i|j.jpg')).toBe('abcdefghij.jpg');
  });

  it('removes null bytes', () => {
    expect(sanitizeUploadFilename('file\x00name.jpg')).toBe('filename.jpg');
  });

  it('removes control characters', () => {
    expect(sanitizeUploadFilename('fi\x1fle.jpg')).toBe('file.jpg');
  });

  it('replaces double-dot sequences with underscore', () => {
    expect(sanitizeUploadFilename('..evil.jpg')).toBe('_evil.jpg');
  });

  it('strips leading dots from base', () => {
    expect(sanitizeUploadFilename('.hidden.jpg')).toBe('hidden.jpg');
  });

  it('returns empty string when base is entirely stripped', () => {
    expect(sanitizeUploadFilename('   .jpg')).toBe('');
  });

  it('lowercases the extension', () => {
    expect(sanitizeUploadFilename('Photo.JPG')).toBe('Photo.jpg');
  });

  it('keeps hyphens and underscores', () => {
    expect(sanitizeUploadFilename('my-photo_01.png')).toBe('my-photo_01.png');
  });
});
