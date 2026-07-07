import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { globSync } from 'glob';
import { validatePathWithin } from '@/lib/security/validation';
import { toNFC } from '@/lib/images/normalize';
import { resolveExistingPath } from '@/lib/fs/resolve-path';

const AD_FILE_EXTENSIONS = new Set(['.yaml', '.yml', '.json']);

// Mirrors the bot's ad_files default (src/kleinanzeigen_bot/__init__.py).
const DEFAULT_AD_FILE_PATTERNS = ['./**/ad_*.{json,yml,yaml}'];

// Our own config/state files that must never be treated as ads, even if a broad
// user ad_files glob (e.g. ./**/*.yaml) would otherwise match them. Dotfiles
// (.bot-config.yaml, .ad-stats.json, .last_download_all.json) are already
// excluded by globSync's dot:false default; listed here only for the non-dot ones.
const NON_AD_BASENAMES = new Set(['config.yaml', 'config.yml', 'config.json', 'users.yaml']);

/**
 * Read the ad_files glob patterns the bot would use, resolved the same way:
 * relative to the config file (the workspace). User workspace config wins over
 * the root config (mirroring readMergedConfig precedence); falls back to the bot
 * default when unset/unreadable. Reads config.yaml directly (no bot spawn) so
 * discovery stays cheap and test-safe.
 */
function getAdFilePatterns(workspace: string): string[] {
  const botDir = process.env.BOT_DIR || process.cwd();
  for (const dir of [workspace, botDir]) {
    try {
      const cfgPath = path.join(dir, 'config.yaml');
      if (!fs.existsSync(cfgPath)) continue;
      const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf-8')) as Record<string, unknown> | undefined;
      const pats = cfg?.ad_files;
      if (Array.isArray(pats) && pats.length > 0 && pats.every((p) => typeof p === 'string')) {
        return pats as string[];
      }
    } catch {
      // Unreadable/invalid config — try the next location, then the default.
    }
  }
  return DEFAULT_AD_FILE_PATTERNS;
}

/** True when `child` is `parent` itself or nested inside it. */
function isWithin(parent: string, child: string): boolean {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  return c === p || c.startsWith(p + path.sep);
}

/**
 * Find all ad config files in a workspace, driven by the bot's ad_files glob
 * (so the GUI loads exactly what the bot loads, regardless of naming templates).
 *
 * @param workspace  Glob base — the directory holding config.yaml.
 * @param opts.scanDir      Restrict results to this subtree (default: whole workspace).
 * @param opts.excludeDirs  Additional subtrees to exclude (e.g. the archive dir).
 */
export function findAdFiles(
  workspace: string,
  opts?: { scanDir?: string; excludeDirs?: string[] },
): string[] {
  const patterns = getAdFilePatterns(workspace);
  const scanDir = opts?.scanDir ?? workspace;
  const templateDir = path.join(workspace, 'ads', 'templates');
  const excluded = [templateDir, ...(opts?.excludeDirs ?? [])];

  let matches: string[];
  try {
    matches = globSync(patterns, { cwd: workspace, absolute: true, nodir: true });
  } catch {
    matches = [];
  }

  const out = new Set<string>();
  for (const match of matches) {
    const abs = path.resolve(match);
    if (!AD_FILE_EXTENSIONS.has(path.extname(abs).toLowerCase())) continue;
    if (NON_AD_BASENAMES.has(path.basename(abs))) continue;
    if (!isWithin(scanDir, abs)) continue;
    if (excluded.some((dir) => isWithin(dir, abs))) continue;
    out.add(abs);
  }
  return [...out].sort();
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

  // shipping_costs is deprecated: a null update removes the key entirely
  // (migration) rather than writing `shipping_costs: null` into the YAML.
  if ('shipping_costs' in updates && updates.shipping_costs == null) {
    delete ad.shipping_costs;
    delete updates.shipping_costs;
  }

  // Apply remaining top-level fields
  Object.assign(ad, updates);
}
