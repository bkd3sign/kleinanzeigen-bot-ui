import fs from 'fs';
import path from 'path';

/**
 * Resolve a path that may exist on disk in either NFC or NFD Unicode form.
 *
 * Linux ext4 matches filenames byte-exact, so a file written in NFD (e.g. from
 * a Mac-synced source or a bot that doesn't normalize) cannot be opened with
 * an NFC string and vice versa. macOS APFS matches both transparently — this
 * helper is mainly a Linux-safety net.
 *
 * Returns the variant that actually exists, or null if none does.
 */
export function resolveExistingPath(candidatePath: string): string | null {
  if (fs.existsSync(candidatePath)) return candidatePath;
  const nfd = candidatePath.normalize('NFD');
  if (nfd !== candidatePath && fs.existsSync(nfd)) return nfd;
  const nfc = candidatePath.normalize('NFC');
  if (nfc !== candidatePath && fs.existsSync(nfc)) return nfc;
  // Per-segment walk handles mixed-form paths (e.g. NFD directory + NFC filename)
  return resolveSegments(candidatePath);
}

function resolveSegments(candidatePath: string): string | null {
  const { root } = path.parse(candidatePath);
  const parts = candidatePath.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    const exact = path.join(current, part);
    if (fs.existsSync(exact)) { current = exact; continue; }
    const nfdPath = path.join(current, part.normalize('NFD'));
    if (nfdPath !== exact && fs.existsSync(nfdPath)) { current = nfdPath; continue; }
    const nfcPath = path.join(current, part.normalize('NFC'));
    if (nfcPath !== exact && fs.existsSync(nfcPath)) { current = nfcPath; continue; }
    return null;
  }
  return current || null;
}
