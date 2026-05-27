import path from 'path';
import { globSync } from 'glob';
import { ALLOWED_IMAGE_EXTENSIONS } from '@/lib/images/upload';
import { toNFC } from '@/lib/images/normalize';

export function resolveImageFiles(
  adDir: string,
  imagePatterns: string[],
): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const pattern of imagePatterns) {
    const fullPattern = path.join(adDir, pattern);
    const matches = globSync(fullPattern).sort();

    for (const match of matches) {
      const ext = path.extname(match).toLowerCase();
      // globSync returns NFD on macOS HFS+/APFS — normalize to NFC for Linux compat
      const rel = toNFC(path.relative(adDir, match));

      if (ALLOWED_IMAGE_EXTENSIONS.has(ext) && !rel.startsWith('..') && !seen.has(rel)) {
        resolved.push(rel);
        seen.add(rel);
      }
    }
  }

  return resolved;
}

export function getFirstImage(
  adDir: string,
  imagePatterns: string[],
): string | null {
  for (const pattern of imagePatterns) {
    const fullPattern = path.join(adDir, pattern);
    const matches = globSync(fullPattern).sort();

    for (const match of matches) {
      const ext = path.extname(match).toLowerCase();
      const rel = toNFC(path.relative(adDir, match));
      if (ALLOWED_IMAGE_EXTENSIONS.has(ext) && !rel.startsWith('..')) {
        return rel;
      }
    }
  }

  return null;
}
