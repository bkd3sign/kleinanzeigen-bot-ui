import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import yaml from 'js-yaml';
import type { UsersData } from '@/types/auth';
import { sanitizeUserId, ApiError } from '@/lib/security/validation';

const BOT_DIR = process.env.BOT_DIR || process.cwd();
const USERS_FILE = path.join(BOT_DIR, 'users.yaml');

// Mtime-based cache to avoid re-parsing on every request
let usersCache: UsersData | null = null;
let usersCacheMtime: number = 0;

/**
 * Read users.yaml with mtime-based caching to avoid re-parsing on every request.
 * Returns null if users.yaml does not exist.
 */
export function loadUsers(): UsersData | null {
  if (!fs.existsSync(USERS_FILE)) {
    usersCache = null;
    return null;
  }
  const stat = fs.statSync(USERS_FILE);
  const mtime = stat.mtimeMs;
  if (usersCache !== null && mtime === usersCacheMtime) {
    return usersCache;
  }
  const content = fs.readFileSync(USERS_FILE, 'utf-8');
  const data = (yaml.load(content) as UsersData) ?? {
    users: [],
    invites: [],
  };
  usersCache = data;
  usersCacheMtime = mtime;
  return data;
}

/**
 * Write users.yaml and update cache.
 */
export function saveUsers(data: UsersData): void {
  const content = yaml.dump(data, {
    flowLevel: -1,
    sortKeys: false,
    noCompatMode: true,
  });
  fs.writeFileSync(USERS_FILE, content, 'utf-8');
  usersCache = data;
  usersCacheMtime = fs.statSync(USERS_FILE).mtimeMs;
}

/**
 * Auto-generate jwt_secret if missing, save to file, and return it.
 */
export function ensureJwtSecret(data: UsersData): string {
  if (!data.jwt_secret) {
    data.jwt_secret = crypto.randomBytes(32).toString('hex');
    saveUsers(data);
  }
  return data.jwt_secret;
}

/**
 * Check if the system is in single-user mode (only one user exists).
 */
export function isSingleUser(): boolean {
  const data = loadUsers();
  return !data || data.users.length <= 1;
}

/**
 * Check if multi-user mode is active (users.yaml exists with >1 user).
 */
export function isMultiUser(): boolean {
  if (!fs.existsSync(USERS_FILE)) return false;
  const data = loadUsers();
  return !!data && data.users.length > 1;
}

/**
 * Get workspace path for a given user ID.
 * Single user (owner only): BOT_DIR root
 * Multi user: BOT_DIR/users/<userId>
 */
export function getUserWorkspace(userId: string): string {
  if (isSingleUser()) {
    return BOT_DIR;
  }
  return path.join(BOT_DIR, 'users', userId);
}

/**
 * Create workspace directories for a new user.
 * Returns the workspace root path.
 */
export function createUserWorkspace(userId: string): string {
  const ws = getUserWorkspace(userId);
  fs.mkdirSync(path.join(ws, 'ads', 'templates'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'downloaded-ads'), { recursive: true });
  return ws;
}

/**
 * Migrate owner data from root to users/<ownerId>/ when switching to multi-user.
 * - Copies only user-specific config (login, ad_defaults) to owner workspace
 * - Server config (browser, timeouts, captcha, diagnostics, etc.) stays on root
 * - Moves ads/ and downloaded-ads/ from root to owner workspace
 * - Cleans up root ads/ and downloaded-ads/
 */
export function migrateOwnerToMultiUser(ownerId: string): void {
  const ownerWs = path.join(BOT_DIR, 'users', ownerId);
  fs.mkdirSync(path.join(ownerWs, 'ads', 'templates'), { recursive: true });
  fs.mkdirSync(path.join(ownerWs, 'downloaded-ads'), { recursive: true });

  // Extract user-specific config from root config.yaml
  const rootConfigPath = path.join(BOT_DIR, 'config.yaml');
  const ownerConfigPath = path.join(ownerWs, 'config.yaml');
  if (fs.existsSync(rootConfigPath)) {
    const rootConfig = yaml.load(fs.readFileSync(rootConfigPath, 'utf-8')) as Record<string, unknown> ?? {};

    // Copy user-specific sections to owner workspace (only if not already migrated)
    if (!fs.existsSync(ownerConfigPath)) {
      const userConfig: Record<string, unknown> = {};
      if (rootConfig.login) userConfig.login = rootConfig.login;
      if (rootConfig.ad_defaults) userConfig.ad_defaults = rootConfig.ad_defaults;
      fs.writeFileSync(ownerConfigPath, yaml.dump(userConfig, { flowLevel: -1, sortKeys: false }), 'utf-8');
    }

    // Remove user-specific keys from root config — in multi-user mode the root
    // config is server-only (browser, timeouts, captcha, etc.).
    // Each user's workspace holds their own login + ad_defaults.
    const serverConfig = { ...rootConfig };
    delete serverConfig.login;
    delete serverConfig.ad_defaults;
    fs.writeFileSync(rootConfigPath, yaml.dump(serverConfig, { flowLevel: -1, sortKeys: false, noCompatMode: true }), 'utf-8');
  }

  // Move ads/
  const rootAds = path.join(BOT_DIR, 'ads');
  const ownerAds = path.join(ownerWs, 'ads');
  if (fs.existsSync(rootAds)) {
    for (const entry of fs.readdirSync(rootAds)) {
      const src = path.join(rootAds, entry);
      const dest = path.join(ownerAds, entry);
      if (!fs.existsSync(dest)) {
        fs.renameSync(src, dest);
      }
    }
    fs.rmSync(rootAds, { recursive: true, force: true });
  }

  // Move downloaded-ads/
  const rootDownloaded = path.join(BOT_DIR, 'downloaded-ads');
  const ownerDownloaded = path.join(ownerWs, 'downloaded-ads');
  if (fs.existsSync(rootDownloaded)) {
    for (const entry of fs.readdirSync(rootDownloaded)) {
      const src = path.join(rootDownloaded, entry);
      const dest = path.join(ownerDownloaded, entry);
      if (!fs.existsSync(dest)) {
        fs.renameSync(src, dest);
      }
    }
    fs.rmSync(rootDownloaded, { recursive: true, force: true });
  }
}

/**
 * Generate a safe user ID from email for use as directory name.
 */
export function generateUserId(email: string): string {
  return sanitizeUserId(email);
}
