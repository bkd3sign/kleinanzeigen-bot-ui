// Matches exactly what kleinanzeigen-bot accepts at publish time
export const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif']);

// Kleinanzeigen allows at most this many images per ad — the staging cap.
export const MAX_AD_IMAGES = 20;
// The AI vision model analyzes at most this many images (extra staged images are still saved).
export const MAX_AI_IMAGES = 10;

export function allowedFormatsLabel(): string {
  return [...ALLOWED_IMAGE_EXTENSIONS].map(e => e.slice(1).toUpperCase()).join(', ');
}

export function filterImageFiles(files: File[]): { accepted: File[]; rejected: string[] } {
  const accepted: File[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
    if (ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      accepted.push(file);
    } else {
      rejected.push(file.name);
    }
  }
  return { accepted, rejected };
}

// Toast message shown when the per-ad image limit is reached.
export const adImageCapMessage = (): string => `Maximal ${MAX_AD_IMAGES} Bilder pro Anzeige.`;

// Toast message shown when files with an unsupported format are dropped/selected.
export const formatRejectMessage = (names: string[]): string =>
  `Format nicht unterstützt: ${names.join(', ')}. Erlaubt: ${allowedFormatsLabel()}`;

export interface ImageLimitResult {
  /** Accepted image files that fit within the remaining room (already capped). */
  toAdd: File[];
  /** Filenames rejected because of an unsupported format. */
  rejectedFormat: string[];
  /** True when accepted files were cut off because the per-ad cap was reached. */
  capExceeded: boolean;
}

// Single source for "filter by format + cap at MAX_AD_IMAGES". Pure — the caller decides
// which toasts to emit (via adImageCapMessage / formatRejectMessage).
export function applyImageLimits(files: File[], currentCount: number): ImageLimitResult {
  const { accepted, rejected } = filterImageFiles(files);
  const room = Math.max(0, MAX_AD_IMAGES - currentCount);
  return {
    toAdd: accepted.slice(0, room),
    rejectedFormat: rejected,
    capExceeded: accepted.length > room,
  };
}
