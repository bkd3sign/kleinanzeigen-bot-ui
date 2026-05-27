import path from 'path';

// Idempotent — safe to call on already-NFC strings (macOS NFD, Linux NFC both work)
export function toNFC(s: string): string {
  return s.normalize('NFC');
}

// Returns '' when no safe base survives — callers must reject that case
export function sanitizeUploadFilename(rawName: string): string {
  const nfc = rawName.normalize('NFC');

  // Remove path separators before handing the string to path utilities.
  // This ensures path.basename does not strip leading path components,
  // so all non-separator chars are preserved for the sanitization pipeline.
  const flat = nfc.replace(/[/\\]/g, '');

  // Extract extension using original casing so path.basename splits correctly,
  // then lowercase it per the sanitization contract.
  const extRaw = path.extname(flat);
  const ext = extRaw.toLowerCase();
  const base = path.basename(flat, extRaw);

  const safe = base
    .replace(/[\x00-\x1f\x7f]/g, '')   // remove control characters and null byte
    .replace(/[:*?"<>|]/g, '')          // remove remaining path-dangerous chars (/ and \ already gone)
    .replace(/\s+/g, '_')              // convert whitespace runs to underscore
    .replace(/\.{2,}/g, '_')           // replace double-dot sequences with underscore
    .replace(/^\.+/, '')               // strip leading dots from base
    .replace(/^_+$/, '');              // treat underscore-only result (was all whitespace) as empty

  if (!safe) return '';
  return safe + ext;
}
