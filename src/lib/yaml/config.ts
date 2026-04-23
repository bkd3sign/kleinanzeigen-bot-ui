import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';
import type { SetupData } from '@/types/bot';

// Default AI configuration — written to server config.yaml during setup.
// Users can customize prompts directly in the config file after setup.
export const AI_DEFAULTS = {
  base_url: 'https://openrouter.ai/api/v1',
  model: 'openai/gpt-4.1-nano',
  model_vision: 'openai/gpt-4.1-mini',
  prompt: 'Du bist ein Kleinanzeigen-Texter. Erstelle eine Anzeige mit Titel, Beschreibung, Highlights und technischen Daten. Antworte NUR mit einem JSON-Objekt: { "title", "description", "category", "price", "price_type", "type", "shipping_type", "shipping_size", "shipping_costs", "shipping_options", "special_attributes", "price_hint": { "uvp", "market_low", "market_high", "suggestion", "condition_note" } }',
  prompt_vision: 'Du bist ein Kleinanzeigen-Texter. Analysiere die Fotos und erstelle eine Anzeige. Beschreibe Artikel, Zustand, Highlights und technische Daten. Antworte NUR mit einem JSON-Objekt: { "title", "description", "category", "price", "price_type", "type", "shipping_type", "shipping_size", "shipping_costs", "shipping_options", "special_attributes", "price_hint": { "uvp", "market_low", "market_high", "suggestion", "condition_note" } }',
};

/**
 * Detect browser binary location based on platform.
 */
function detectBrowserBinary(): string {
  if (fs.existsSync('/usr/bin/chromium')) {
    // Docker / Linux with Chromium installed
    return '/usr/bin/chromium';
  }
  if (os.platform() === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  // Let the bot auto-detect
  return '';
}

/**
 * Default browser configuration for the bot CLI.
 */
export const BROWSER_DEFAULTS: Record<string, unknown> = {
  arguments: [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--password-store=basic',
  ],
  binary_location: detectBrowserBinary(),
  use_private_window: true,
  extensions: [],
  user_data_dir: '',
  profile_name: '',
};

/**
 * Read config.yaml from a workspace directory.
 */
export function readConfig(workspace: string): Record<string, unknown> {
  const configPath = path.join(workspace, 'config.yaml');
  if (!fs.existsSync(configPath)) {
    return {};
  }
  const content = fs.readFileSync(configPath, 'utf-8');
  return (yaml.load(content) as Record<string, unknown>) ?? {};
}

/**
 * Write config.yaml to a workspace directory.
 */
export function writeConfig(
  workspace: string,
  config: Record<string, unknown>,
): void {
  const configPath = path.join(workspace, 'config.yaml');
  const content = yaml.dump(config, {
    flowLevel: -1,
    sortKeys: false,
    noCompatMode: true,
  });
  fs.writeFileSync(configPath, content, 'utf-8');
}

// User-specific config keys written to users/<id>/config.yaml in multi-user mode.
// Everything else (browser, captcha, timeouts, update_check, publishing, download,
// diagnostics, ad_files, categories) is server config and stays in the root config.yaml.
const USER_CONFIG_KEYS = new Set(['login', 'ad_defaults']);

/**
 * Read merged config: root config (source of truth for server settings) + user
 * settings from workspace. Bot defaults only fill in keys that are completely
 * absent — the root config is never overwritten.
 */
export function readMergedConfig(workspace: string): Record<string, unknown> {
  const botDir = process.env.BOT_DIR || process.cwd();
  const rootConfig = readConfig(botDir);
  const defaults = loadBotDefaults();

  // Start with bot defaults, then layer root config (server truth), then user config
  let config: Record<string, unknown>;
  if (workspace === botDir) {
    config = fillMissingDefaults(rootConfig, defaults);
  } else {
    const userConfig = readConfig(workspace);
    const merged = { ...rootConfig, ...userConfig };
    config = fillMissingDefaults(merged, defaults);
  }

  // Fill missing browser keys from defaults but never overwrite root config values
  if (!config.browser || !Object.keys(config.browser as object).length) {
    config.browser = { ...BROWSER_DEFAULTS };
  } else {
    config.browser = fillMissingDefaults(
      config.browser as Record<string, unknown>,
      BROWSER_DEFAULTS,
    );
  }

  return config;
}

/**
 * Write only user-specific keys to the workspace config.
 * Server-wide keys are written to the root config.
 */
export function writeUserConfig(
  workspace: string,
  updates: Record<string, unknown>,
): void {
  const botDir = process.env.BOT_DIR || process.cwd();

  if (workspace === botDir) {
    // Single user: everything goes to root
    const config = readConfig(botDir);
    Object.assign(config, updates);
    writeConfig(botDir, config);
    return;
  }

  // Multi user: split user vs server keys
  const userUpdates: Record<string, unknown> = {};
  const serverUpdates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (USER_CONFIG_KEYS.has(key)) {
      userUpdates[key] = value;
    } else {
      serverUpdates[key] = value;
    }
  }

  // Write user-specific keys to workspace config
  if (Object.keys(userUpdates).length > 0) {
    const userConfig = readConfig(workspace);
    for (const [key, value] of Object.entries(userUpdates)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const existing = userConfig[key];
        if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
          userConfig[key] = { ...(existing as Record<string, unknown>), ...value };
        } else {
          userConfig[key] = value;
        }
      } else {
        userConfig[key] = value;
      }
    }
    writeConfig(workspace, userConfig);
  }

  // Write server keys to root config (admin only)
  if (Object.keys(serverUpdates).length > 0) {
    const rootConfig = readConfig(botDir);
    Object.assign(rootConfig, serverUpdates);
    writeConfig(botDir, rootConfig);
  }
}

/**
 * Empty fallback — only used when the bot binary is completely unavailable
 * (e.g. local dev without bot installed). In production the bot is always
 * present and loadBotDefaults() provides the authoritative defaults via
 * `create-config`. No manual maintenance needed here.
 */
export const CONFIG_DEFAULTS: Record<string, unknown> = {
  ad_defaults: {
    active: true,
    type: 'OFFER',
    price_type: 'NEGOTIABLE',
    shipping_type: 'SHIPPING',
    sell_directly: false,
    republication_interval: 7,
    description_prefix: '',
    description_suffix: '',
    contact: {
      name: '',
      street: '',
      zipcode: '',
      location: '',
      phone: '',
    },
  },
  download: {
    folder_name_template: 'ad_{id}',
    rename_existing_folders: true,
  },
};

/**
 * In-memory cache for bot-generated defaults.
 * Populated once per server process via loadBotDefaults().
 */
let botDefaultsCache: Record<string, unknown> | null = null;

/**
 * Ask the bot itself for its current defaults by running `create-config` into a
 * temporary directory.  This way our defaults automatically stay in sync when
 * the bot binary is updated — no manual maintenance required.
 *
 * Falls back to the hardcoded CONFIG_DEFAULTS when the bot binary is not
 * available (local dev without the bot installed, CI, etc.).
 */
export function loadBotDefaults(): Record<string, unknown> {
  if (botDefaultsCache) return botDefaultsCache;

  try {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-defaults-'));
    const tmpConfig = path.join(tmpDir, 'config.yaml');
    const botCmd = process.env.BOT_CMD ?? 'kleinanzeigen-bot';

    // Use execFileSync (not execSync) to avoid shell injection
    execFileSync(botCmd, [`--config=${tmpConfig}`, 'create-config'], {
      timeout: 15_000,
      stdio: 'ignore',
    });

    const content = fs.readFileSync(tmpConfig, 'utf-8');
    const parsed = (yaml.load(content) as Record<string, unknown>) ?? {};
    fs.rmSync(tmpDir, { recursive: true, force: true });

    botDefaultsCache = parsed;
    return botDefaultsCache;
  } catch {
    // Bot not installed or create-config failed — use hardcoded fallback
    botDefaultsCache = CONFIG_DEFAULTS;
    return CONFIG_DEFAULTS;
  }
}

/**
 * Deep-merge: fills missing keys in `target` with values from `defaults`.
 * Existing user values are never overwritten — only absent keys get defaults.
 */
function fillMissingDefaults(
  target: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, defaultVal] of Object.entries(defaults)) {
    if (!(key in result) || result[key] === null || result[key] === undefined) {
      result[key] = defaultVal;
    } else if (
      defaultVal !== null &&
      typeof defaultVal === 'object' &&
      !Array.isArray(defaultVal) &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      // Recurse into nested objects
      result[key] = fillMissingDefaults(
        result[key] as Record<string, unknown>,
        defaultVal as Record<string, unknown>,
      );
    }
  }
  return result;
}

/**
 * Build a user config.yaml from setup data.
 * Contains only user-specific keys (login, ad_defaults).
 */
export function buildConfig(data: SetupData): Record<string, unknown> {
  const defaults = loadBotDefaults();
  return {
    login: {
      username: data.username,
      password: data.password,
    },
    ad_defaults: {
      ...(defaults.ad_defaults as Record<string, unknown>),
      contact: {
        name: data.contact_name ?? '',
        street: '',
        zipcode: data.contact_zipcode ?? '',
        location: data.contact_location ?? '',
        phone: '',
      },
    },
  };
}

/**
 * Build the server-wide config.yaml from setup data.
 * Contains shared settings: ai, browser, download, publishing, etc.
 * Written to BOT_DIR root, not the user workspace.
 *
 * Preserves existing root config values (e.g. prompts from config.yaml shipped
 * with the deployment) and only overrides setup-specific fields.
 */
export function buildServerConfig(data: SetupData): Record<string, unknown> {
  const botDir = process.env.BOT_DIR || process.cwd();
  const existing = readConfig(botDir);
  const defaults = loadBotDefaults();
  // Existing root config wins over bot defaults
  const config = fillMissingDefaults(existing, defaults);

  // Merge AI config: keep existing prompts if present, fall back to AI_DEFAULTS
  const existingAi = (existing.ai as Record<string, unknown>) ?? {};
  config.ai = {
    ...AI_DEFAULTS,
    ...existingAi,
    api_key: data.openrouter_api_key ?? existingAi.api_key ?? '',
  };

  // Fill missing browser keys but respect existing values
  const existingBrowser = (existing.browser as Record<string, unknown>) ?? {};
  config.browser = { ...BROWSER_DEFAULTS, ...existingBrowser };

  return config;
}
