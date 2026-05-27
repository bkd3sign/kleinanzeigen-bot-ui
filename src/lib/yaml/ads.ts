import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { validatePathWithin } from '@/lib/security/validation';
import { toNFC } from '@/lib/images/normalize';
import { resolveExistingPath } from '@/lib/fs/resolve-path';

const AD_FILE_EXTENSIONS = new Set(['.yaml', '.yml', '.json']);

/**
 * Find all ad YAML files matching the bot's glob pattern in a workspace.
 * Excludes files in the templates directory and any additional directories
 * passed via excludeDirs.
 */
export function findAdFiles(workspace: string, excludeDirs?: string[]): string[] {
  const templateDir = path.join(workspace, 'ads', 'templates');
  const excluded = new Set([templateDir, ...(excludeDirs ?? [])]);
  const files: string[] = [];

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excluded.has(fullPath)) walk(fullPath);
      } else if (
        entry.isFile() &&
        entry.name.startsWith('ad_') &&
        AD_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        files.push(fullPath);
      }
    }
  }

  walk(workspace);
  return files.sort();
}

/**
 * Read and parse an ad YAML file.
 */
export function readAd(filePath: string): Record<string, unknown> {
  const content = fs.readFileSync(filePath, 'utf-8');
  try {
    return (yaml.load(content) as Record<string, unknown>) ?? {};
  } catch {
    // Fallback: strip the description block that often contains problematic
    // Unicode chars (curly quotes from bot downloads) and re-parse
    try {
      const stripped = content.replace(
        /^(description:\s*\|[-+]?\s*\n)([\s\S]*?)(\n\w)/m,
        (_m, prefix, _desc, next) => `${prefix}  (Beschreibung konnte nicht geladen werden)\n${next}`,
      );
      const data = (yaml.load(stripped) as Record<string, unknown>) ?? {};
      // Re-read the raw description from the original content
      const descMatch = content.match(/^description:\s*\|[-+]?\s*\n([\s\S]*?)(?=\n[a-z_]+:)/m);
      if (descMatch) {
        data.description = descMatch[1].replace(/^ {2}/gm, '').trim();
      }
      return data;
    } catch {
      return { _parse_error: true, title: path.basename(filePath, '.yaml') };
    }
  }
}

/**
 * Write ad data to a YAML file.
 */
export function writeAd(
  filePath: string,
  data: Record<string, unknown>,
): void {
  const content = yaml.dump(data, {
    flowLevel: -1,
    sortKeys: false,
    noCompatMode: true,
  });
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Find an ad file by its Kleinanzeigen ID.
 * Returns the file path and parsed ad data, or null if not found.
 */
export function findAdById(
  adId: number,
  workspace: string,
): { path: string; ad: Record<string, unknown> } | null {
  for (const filePath of findAdFiles(workspace)) {
    const ad = readAd(filePath);
    if (ad.id === adId) {
      return { path: filePath, ad };
    }
  }
  return null;
}

export function findAdByFile(
  filename: string,
  workspace: string,
): { path: string; ad: Record<string, unknown> } | null {
  const nfc = toNFC(filename);
  const folderName = path.basename(path.dirname(nfc));
  const fileBaseName = path.basename(nfc);

  // Build all plausible relative paths.
  const relativePaths: string[] = [nfc, path.join('ads', nfc)];
  if (folderName && folderName !== '.' && folderName !== nfc) {
    // File may have been moved by archive/unarchive — try standard locations.
    relativePaths.push(
      path.join('downloaded-ads', folderName, fileBaseName),
      path.join('ads', folderName, fileBaseName),
      path.join('archive', 'downloads', folderName, fileBaseName),
      path.join('archive', 'ads', folderName, fileBaseName),
    );
  }

  // Try each path — resolveExistingPath checks both NFC and NFD on disk
  // (Linux ext4 matches byte-exact, so files written in NFD need NFD lookup).
  for (const relPath of relativePaths) {
    const candidate = path.join(workspace, relPath);
    try {
      validatePathWithin(candidate, workspace);
      const resolved = resolveExistingPath(candidate);
      if (resolved && fs.statSync(resolved).isFile()) {
        return { path: resolved, ad: readAd(resolved) };
      }
    } catch { /* path traversal */ }
  }

  return null;
}

/**
 * Apply update data to an ad dict, handling nested contact,
 * auto_price_reduction, and special_attributes fields.
 */
export function applyAdUpdates(
  ad: Record<string, unknown>,
  updates: Record<string, unknown>,
): void {
  const contactFields: Record<string, string> = {
    contact_name: 'name',
    contact_zipcode: 'zipcode',
    contact_location: 'location',
    contact_street: 'street',
    contact_phone: 'phone',
  };

  const contactUpdates: Record<string, unknown> = {};
  for (const [field, key] of Object.entries(contactFields)) {
    if (field in updates) {
      contactUpdates[key] = updates[field];
      delete updates[field];
    }
  }

  if (Object.keys(contactUpdates).length > 0) {
    const existing =
      (ad.contact as Record<string, unknown>) ?? {};
    ad.contact = { ...existing, ...contactUpdates };
  }

  if ('auto_price_reduction' in updates) {
    ad.auto_price_reduction = updates.auto_price_reduction;
    delete updates.auto_price_reduction;
  }

  if ('special_attributes' in updates) {
    // Strip category prefix from keys (e.g. "kleidung_herren.art_s" → "art_s")
    const raw = updates.special_attributes ?? {};
    ad.special_attributes = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k.includes('.') ? k.split('.').pop()! : k, v]),
    );
    delete updates.special_attributes;
  }

  // Apply remaining top-level fields
  Object.assign(ad, updates);
}
