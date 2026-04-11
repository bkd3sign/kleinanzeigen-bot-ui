import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';
import { ALLOWED_IMAGE_EXTENSIONS } from '@/lib/images/upload';

/**
 * Resolve image glob patterns to actual filenames within an ad directory.
 * Deduplicates results by filename.
 */
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
      const name = path.basename(match);

      if (ALLOWED_IMAGE_EXTENSIONS.has(ext) && !seen.has(name)) {
        resolved.push(name);
        seen.add(name);
      }
    }
  }

  return resolved;
}

/**
 * Get the first resolved image filename for list preview, or null if none found.
 */
export function getFirstImage(
  adDir: string,
  imagePatterns: string[],
): string | null {
  for (const pattern of imagePatterns) {
    const fullPattern = path.join(adDir, pattern);
    const matches = globSync(fullPattern).sort();

    for (const match of matches) {
      const ext = path.extname(match).toLowerCase();
      if (ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
        return path.basename(match);
      }
    }
  }

  return null;
}
