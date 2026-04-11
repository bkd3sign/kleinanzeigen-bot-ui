import { execFileSync } from 'child_process';
import path from 'path';

const BOT_DIR = process.env.BOT_DIR || process.cwd();
const BOT_CMD = process.env.BOT_CMD || path.join(BOT_DIR, 'bot', 'kleinanzeigen-bot');

const UPSTREAM_REPO = 'Second-Hand-Friends/kleinanzeigen-bot';
const UPSTREAM_SOURCE_PATH = 'src/kleinanzeigen_bot/__init__.py';

export type CheckStatus = 'ok' | 'warning' | 'error';

export interface CommandCheck {
  command: string;
  status: CheckStatus;
  message: string;
}

export interface FlagCheck {
  command: string;
  flag: string;
  status: CheckStatus;
  message: string;
}

export interface SchemaCheck {
  schema: 'ad' | 'config';
  field: string;
  status: CheckStatus;
  message: string;
  /** Field details from upstream JSON Schema (only for new/changed fields) */
  detail?: {
    type?: string;
    description?: string;
    default?: unknown;
    enum?: string[];
  };
}

export interface CompatibilityResult {
  botVersion: string;
  overallStatus: CheckStatus;
  commands: CommandCheck[];
  flags: FlagCheck[];
  schemas: SchemaCheck[];
  summary: string;
}

// GUI route map: commands we support and their known flags
const GUI_COMMANDS: Record<string, string[]> = {
  publish: ['--ads', '--force', '--keep-old', '--verbose'],
  verify: ['--verbose'],
  delete: ['--ads', '--verbose'],
  update: ['--ads', '--verbose'],
  download: ['--ads', '--verbose'],
  extend: ['--ads', '--verbose'],
  'update-check': [],
  'update-content-hash': [],
  'create-config': [],
  diagnose: [],
};

// Global flags the bot supports (not command-specific)
const GLOBAL_FLAGS = ['--config', '--workspace-mode', '--logfile', '--lang', '--verbose', '-v'];

// Ad fields the GUI knows about (from adCreateSchema + bot-managed fields)
const GUI_AD_FIELDS = new Set([
  'active', 'type', 'title', 'description', 'category', 'price', 'price_type',
  'shipping_type', 'shipping_costs', 'shipping_options', 'sell_directly',
  'images', 'contact', 'republication_interval', 'description_prefix',
  'description_suffix', 'special_attributes', 'auto_price_reduction',
  // Bot-managed fields (read-only in GUI)
  'id', 'created_on', 'updated_on', 'content_hash', 'repost_count', 'price_reduction_count',
]);

// Config sections the GUI knows about
const GUI_CONFIG_SECTIONS = new Set([
  'login', 'ad_defaults', 'browser', 'publishing', 'timeouts',
  'download', 'update_check', 'ad_files', 'categories', 'captcha', 'diagnostics',
]);

// Known enum values the GUI supports (for detecting new enum options)
const GUI_KNOWN_ENUMS: Record<string, string[]> = {
  'ad.type': ['OFFER', 'WANTED'],
  'ad.price_type': ['FIXED', 'NEGOTIABLE', 'GIVE_AWAY', 'NOT_APPLICABLE'],
  'ad.shipping_type': ['PICKUP', 'SHIPPING', 'NOT_APPLICABLE'],
  'ad.auto_price_reduction.strategy': ['FIXED', 'PERCENTAGE'],
  'config.PublishingConfig.delete_old_ads': ['BEFORE_PUBLISH', 'AFTER_PUBLISH', 'NEVER'],
  'config.UpdateCheckConfig.channel': ['latest', 'preview'],
};

// Known sub-properties per $defs section (for detecting new nested fields)
const GUI_KNOWN_SUB_FIELDS: Record<string, Set<string>> = {
  'ContactPartial': new Set(['name', 'street', 'zipcode', 'location', 'phone']),
  'ContactDefaults': new Set(['name', 'street', 'zipcode', 'location', 'phone']),
  'AutoPriceReductionConfig': new Set(['enabled', 'strategy', 'amount', 'min_price', 'delay_reposts', 'delay_days', 'on_update']),
  'AdDefaults': new Set([
    'active', 'type', 'price_type', 'shipping_type', 'sell_directly',
    'republication_interval', 'description_prefix', 'description_suffix',
    'description', 'images', 'contact', 'auto_price_reduction',
  ]),
  'DownloadConfig': new Set([
    'folder_name_max_length', 'rename_existing_folders',
    'include_all_matching_shipping_options', 'excluded_shipping_options',
    'dir', 'folder_name_template', 'ad_file_name_template',
  ]),
  'BrowserConfig': new Set([
    'arguments', 'binary_location', 'use_private_window',
    'extensions', 'user_data_dir', 'profile_name',
  ]),
  'LoginConfig': new Set(['username', 'password']),
  'PublishingConfig': new Set(['delete_old_ads', 'delete_old_ads_by_title']),
  'CaptchaConfig': new Set(['auto_restart', 'restart_delay']),
  'DiagnosticsConfig': new Set([
    'capture_on', 'timing_collection', 'output_dir',
    'capture_log_copy', 'pause_on_login_detection_failure',
  ]),
  'UpdateCheckConfig': new Set(['enabled', 'channel', 'interval']),
  'TimeoutConfig': new Set([
    'multiplier', 'default', 'page_load', 'image_upload', 'publishing_result',
    'publishing_confirmation', 'login_detection', 'gdpr_prompt', 'quick_dom',
    'captcha_detection', 'sms_verification', 'email_verification',
    'update_check', 'chrome_binary_detection', 'chrome_remote_debugging',
    'chrome_remote_probe', 'pagination_initial', 'pagination_follow_up',
    'retry_enabled', 'retry_max_attempts', 'retry_backoff_factor',
  ]),
};

const SCHEMA_BASE = `https://api.github.com/repos/${UPSTREAM_REPO}/contents/schemas`;

interface SchemaProperty {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
}

interface DefSection {
  fields: string[];
  properties: Record<string, SchemaProperty>;
}

interface ParsedSchema {
  fields: string[];
  properties: Record<string, SchemaProperty>;
  defs: Record<string, DefSection>;
}

/**
 * Extract type, description, default, and enum from a JSON Schema property.
 */
function parseProperty(val: Record<string, unknown>): SchemaProperty {
  let type = val.type as string | undefined;
  if (!type && Array.isArray(val.anyOf)) {
    const types = (val.anyOf as Record<string, unknown>[])
      .map(a => a.type as string).filter(t => t && t !== 'null');
    type = types.join(' | ') || undefined;
  }

  let enumValues = val.enum as string[] | undefined;
  if (!enumValues && Array.isArray(val.anyOf)) {
    for (const a of val.anyOf as Record<string, unknown>[]) {
      if (Array.isArray(a.enum)) { enumValues = a.enum as string[]; break; }
    }
  }

  return {
    type,
    description: val.description as string | undefined,
    default: val.default,
    enum: enumValues,
  };
}

/**
 * Fetch a JSON schema from the upstream repo and extract properties + $defs.
 */
async function fetchSchema(schemaPath: string): Promise<ParsedSchema | null> {
  try {
    const res = await fetch(`${SCHEMA_BASE}/${schemaPath}`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { content?: string };
    if (!json.content) return null;
    const schema = JSON.parse(Buffer.from(json.content, 'base64').toString('utf-8'));

    // Parse top-level properties
    const rawProps = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const properties: Record<string, SchemaProperty> = {};
    for (const [key, val] of Object.entries(rawProps)) {
      properties[key] = parseProperty(val);
    }

    // Parse $defs (nested schemas like AutoPriceReductionConfig, DownloadConfig, etc.)
    const defs: Record<string, DefSection> = {};
    const rawDefs = (schema.$defs ?? {}) as Record<string, Record<string, unknown>>;
    for (const [defName, defVal] of Object.entries(rawDefs)) {
      const defProps = (defVal.properties ?? {}) as Record<string, Record<string, unknown>>;
      const defProperties: Record<string, SchemaProperty> = {};
      for (const [pk, pv] of Object.entries(defProps)) {
        defProperties[pk] = parseProperty(pv);
      }
      defs[defName] = { fields: Object.keys(defProps), properties: defProperties };
    }

    return { fields: Object.keys(rawProps), properties, defs };
  } catch {
    return null;
  }
}

/**
 * Compare upstream schema against GUI-known fields, enums, and sub-properties.
 */
function compareSchemaFields(
  schemaType: 'ad' | 'config',
  schema: ParsedSchema,
  guiFields: Set<string>,
): SchemaCheck[] {
  const checks: SchemaCheck[] = [];

  // 1. Top-level field presence
  for (const field of schema.fields) {
    if (guiFields.has(field)) {
      checks.push({ schema: schemaType, field, status: 'ok', message: 'Feld wird von der GUI unterstützt' });
    } else {
      const prop = schema.properties[field];
      const parts: string[] = [`Neues Feld in ${schemaType}.schema.json`];
      if (prop.description) parts.push(prop.description);
      checks.push({ schema: schemaType, field, status: 'warning', message: parts.join(' — '), detail: prop });
    }
  }

  for (const field of guiFields) {
    if (!schema.fields.includes(field)) {
      checks.push({ schema: schemaType, field, status: 'error', message: `GUI nutzt Feld, aber es wurde aus ${schemaType}.schema.json entfernt` });
    }
  }

  // 2. Enum value checks — detect new enum options the GUI doesn't offer yet
  for (const field of schema.fields) {
    const prop = schema.properties[field];
    if (!prop.enum) continue;
    const enumKey = `${schemaType}.${field}`;
    const knownValues = GUI_KNOWN_ENUMS[enumKey];
    if (!knownValues) continue;
    for (const val of prop.enum) {
      if (!knownValues.includes(val)) {
        checks.push({
          schema: schemaType,
          field: `${field}=${val}`,
          status: 'warning',
          message: `Neuer Enum-Wert "${val}" für ${field} — GUI-Dropdown fehlt diese Option`,
          detail: { type: 'enum', enum: prop.enum },
        });
      }
    }
  }

  // 3. $defs sub-property checks — detect new nested fields
  for (const [defName, defSection] of Object.entries(schema.defs)) {
    const knownFields = GUI_KNOWN_SUB_FIELDS[defName];
    if (!knownFields) continue;

    for (const subField of defSection.fields) {
      if (!knownFields.has(subField)) {
        const prop = defSection.properties[subField];
        const parts: string[] = [`Neues Sub-Feld ${defName}.${subField}`];
        if (prop.description) parts.push(prop.description);
        checks.push({
          schema: schemaType,
          field: `${defName}.${subField}`,
          status: 'warning',
          message: parts.join(' — '),
          detail: prop,
        });
      }
    }

    for (const knownField of knownFields) {
      if (!defSection.fields.includes(knownField)) {
        checks.push({
          schema: schemaType,
          field: `${defName}.${knownField}`,
          status: 'error',
          message: `GUI nutzt ${defName}.${knownField}, aber Feld wurde aus Schema entfernt`,
        });
      }
    }

    // 4. Enum checks within $defs
    for (const subField of defSection.fields) {
      const prop = defSection.properties[subField];
      if (!prop.enum) continue;
      const enumKey = `${schemaType}.${defName}.${subField}`;
      const knownValues = GUI_KNOWN_ENUMS[enumKey];
      if (!knownValues) continue;
      for (const val of prop.enum) {
        if (!knownValues.includes(val)) {
          checks.push({
            schema: schemaType,
            field: `${defName}.${subField}=${val}`,
            status: 'warning',
            message: `Neuer Enum-Wert "${val}" für ${defName}.${subField}`,
            detail: { type: 'enum', enum: prop.enum },
          });
        }
      }
    }
  }

  return checks;
}

/**
 * Parse the bot help output to extract commands and flags.
 */
function parseBotHelp(helpText: string): { commands: string[]; commandFlags: Record<string, string[]> } {
  const commands: string[] = [];
  const commandFlags: Record<string, string[]> = {};

  const lines = helpText.split('\n');
  let inCommands = false;

  for (const line of lines) {
    if (line.includes('Befehle:') || line.includes('Commands:')) {
      inCommands = true;
      continue;
    }
    if (line.includes('Optionen:') || line.includes('Options:')) {
      inCommands = false;
      continue;
    }

    if (inCommands) {
      const cmdMatch = line.match(/^\s{2}(\S+)\s+- /);
      if (cmdMatch) {
        const cmd = cmdMatch[1];
        if (cmd !== 'help' && cmd !== 'version' && cmd !== '--') {
          commands.push(cmd);
        }
      }
    }
  }

  // Parse --ads= flags per command
  const adsMatches = helpText.matchAll(/--ads=\S+\s+\((\w+)\)/g);
  for (const m of adsMatches) {
    const cmd = m[1];
    if (!commandFlags[cmd]) commandFlags[cmd] = [];
    if (!commandFlags[cmd].includes('--ads')) {
      commandFlags[cmd].push('--ads');
    }
  }

  // Parse specific flags
  const flagMatches = helpText.matchAll(/^\s{2}(--[\w-]+)/gm);
  for (const m of flagMatches) {
    const flag = m[1];
    if (flag === '--force') {
      if (!commandFlags['publish']) commandFlags['publish'] = [];
      if (!commandFlags['publish'].includes('--force')) {
        commandFlags['publish'].push('--force');
      }
    }
    if (flag === '--keep-old') {
      if (!commandFlags['publish']) commandFlags['publish'] = [];
      if (!commandFlags['publish'].includes('--keep-old')) {
        commandFlags['publish'].push('--keep-old');
      }
    }
  }

  // Commands that accept --ads even if not explicitly listed in help for each
  const ADS_COMMANDS = ['publish', 'delete', 'update', 'download', 'extend'];
  for (const cmd of ADS_COMMANDS) {
    if (commands.includes(cmd)) {
      if (!commandFlags[cmd]) commandFlags[cmd] = [];
      if (!commandFlags[cmd].includes('--ads')) {
        commandFlags[cmd].push('--ads');
      }
    }
  }

  // All commands get --verbose
  for (const cmd of commands) {
    if (!commandFlags[cmd]) commandFlags[cmd] = [];
    if (!commandFlags[cmd].includes('--verbose')) {
      commandFlags[cmd].push('--verbose');
    }
  }

  return { commands, commandFlags };
}

/**
 * Run the compatibility check between bot CLI and GUI route map.
 */
export function checkCompatibility(): CompatibilityResult {
  let helpOutput: string;
  let botVersion = 'unbekannt';

  try {
    botVersion = execFileSync(BOT_CMD, ['version'], { timeout: 10000 }).toString().trim();
  } catch {
    // ignore
  }

  try {
    helpOutput = execFileSync(BOT_CMD, ['help'], { timeout: 10000 }).toString();
  } catch {
    return {
      botVersion,
      overallStatus: 'error',
      commands: [],
      flags: [],
      schemas: [],
      summary: 'Bot-Binary nicht erreichbar. Kompatibilitätsprüfung nicht möglich.',
    };
  }

  const { commands: botCommands, commandFlags: botFlags } = parseBotHelp(helpOutput);
  const guiCommands = Object.keys(GUI_COMMANDS);

  const commandChecks: CommandCheck[] = [];
  const flagChecks: FlagCheck[] = [];

  // Check each GUI command against bot
  for (const cmd of guiCommands) {
    if (botCommands.includes(cmd)) {
      commandChecks.push({
        command: cmd,
        status: 'ok',
        message: 'API-Endpoint vorhanden, Bot unterstützt Befehl',
      });
    } else {
      commandChecks.push({
        command: cmd,
        status: 'error',
        message: 'GUI bietet diesen Befehl an, aber Bot kennt ihn nicht mehr',
      });
    }
  }

  // Check for new bot commands not in GUI
  for (const cmd of botCommands) {
    if (!guiCommands.includes(cmd)) {
      commandChecks.push({
        command: cmd,
        status: 'warning',
        message: 'Neuer Bot-Befehl, kein API-Endpoint in der GUI vorhanden',
      });
    }
  }

  // Check flags for each command
  for (const cmd of guiCommands) {
    if (!botCommands.includes(cmd)) continue;

    const guiFlags = GUI_COMMANDS[cmd];
    const botCmdFlags = botFlags[cmd] || [];

    for (const flag of guiFlags) {
      if (botCmdFlags.includes(flag)) {
        flagChecks.push({ command: cmd, flag, status: 'ok', message: 'Flag wird vom Bot unterstützt' });
      } else {
        flagChecks.push({ command: cmd, flag, status: 'error', message: 'GUI nutzt diesen Flag, aber Bot unterstützt ihn nicht mehr' });
      }
    }

    for (const flag of botCmdFlags) {
      if (!guiFlags.includes(flag) && !GLOBAL_FLAGS.includes(flag)) {
        flagChecks.push({ command: cmd, flag, status: 'warning', message: 'Neuer Bot-Flag, nicht in der GUI konfiguriert' });
      }
    }
  }

  const hasErrors = commandChecks.some(c => c.status === 'error') || flagChecks.some(f => f.status === 'error');
  const hasWarnings = commandChecks.some(c => c.status === 'warning') || flagChecks.some(f => f.status === 'warning');
  const errorCount = commandChecks.filter(c => c.status === 'error').length + flagChecks.filter(f => f.status === 'error').length;
  const warningCount = commandChecks.filter(c => c.status === 'warning').length + flagChecks.filter(f => f.status === 'warning').length;

  let overallStatus: CheckStatus = 'ok';
  let summary = `GUI ist vollständig kompatibel mit Bot ${botVersion}`;

  if (hasErrors) {
    overallStatus = 'error';
    summary = `${errorCount} Inkompatibilität${errorCount > 1 ? 'en' : ''} gefunden — GUI-Update nötig`;
  } else if (hasWarnings) {
    overallStatus = 'warning';
    summary = `${warningCount} neue${warningCount > 1 ? '' : 's'} Feature${warningCount > 1 ? 's' : ''} verfügbar, die die GUI noch nicht unterstützt`;
  }

  return { botVersion, overallStatus, commands: commandChecks, flags: flagChecks, schemas: [], summary };
}

/**
 * Parse upstream source code to extract commands and flags.
 * Parses `case "command":` and `case "--flag":` patterns from __init__.py.
 */
function parseUpstreamSource(source: string): { commands: string[]; flags: string[] } {
  const commands: string[] = [];
  const flags: string[] = [];

  const caseMatches = source.matchAll(/case\s+"([^"]+)"/g);
  for (const m of caseMatches) {
    const val = m[1];
    if (val.startsWith('--')) {
      flags.push(val);
    } else if (val.startsWith('-')) {
      // Short flags like -v, -h
      continue;
    } else if (!['help', 'version'].includes(val)) {
      commands.push(val);
    }
  }

  return {
    commands: [...new Set(commands)],
    flags: [...new Set(flags)],
  };
}

/**
 * Check compatibility against the UPSTREAM (latest) version from GitHub.
 * Fetches source code from the repo and compares commands/flags.
 */
export async function checkUpstreamCompatibility(version: string): Promise<CompatibilityResult> {
  const guiCommands = Object.keys(GUI_COMMANDS);
  const guiFlags = new Set(
    Object.entries(GUI_COMMANDS).flatMap(([, flags]) => flags).concat(GLOBAL_FLAGS)
  );

  let source: string;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${UPSTREAM_REPO}/contents/${UPSTREAM_SOURCE_PATH}`,
      { headers: { Accept: 'application/vnd.github.v3+json' }, signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
    const json = await res.json() as { content?: string };
    if (!json.content) throw new Error('No content in response');
    source = Buffer.from(json.content, 'base64').toString('utf-8');
  } catch {
    return {
      botVersion: version,
      overallStatus: 'error',
      commands: [],
      flags: [],
      schemas: [],
      summary: 'Konnte Upstream-Quellcode nicht abrufen. Prüfe deine Internetverbindung.',
    };
  }

  const { commands: upstreamCommands, flags: upstreamFlags } = parseUpstreamSource(source);

  const commandChecks: CommandCheck[] = [];
  const flagChecks: FlagCheck[] = [];

  // Check GUI commands against upstream
  for (const cmd of guiCommands) {
    if (upstreamCommands.includes(cmd)) {
      commandChecks.push({ command: cmd, status: 'ok', message: 'Befehl existiert auch in der neuen Version' });
    } else {
      commandChecks.push({ command: cmd, status: 'error', message: 'Befehl wurde in der neuen Version entfernt' });
    }
  }

  // Check for new upstream commands
  for (const cmd of upstreamCommands) {
    if (!guiCommands.includes(cmd)) {
      commandChecks.push({ command: cmd, status: 'warning', message: 'Neuer Befehl in der neuen Version, nicht in der GUI' });
    }
  }

  // Check upstream flags
  for (const flag of upstreamFlags) {
    if (GLOBAL_FLAGS.includes(flag)) continue;
    if (guiFlags.has(flag)) {
      flagChecks.push({ command: '*', flag, status: 'ok', message: 'Flag existiert auch in der GUI' });
    } else {
      flagChecks.push({ command: '*', flag, status: 'warning', message: 'Neuer Flag in der neuen Version, nicht in der GUI' });
    }
  }

  // Check if GUI flags still exist upstream
  const allGuiFlags = Object.entries(GUI_COMMANDS).flatMap(([cmd, flags]) =>
    flags.filter(f => !GLOBAL_FLAGS.includes(f)).map(f => ({ cmd, flag: f }))
  );
  for (const { cmd, flag } of allGuiFlags) {
    if (!upstreamFlags.includes(flag)) {
      // --ads is used as a prefix, not exact match in case statements
      if (flag === '--ads' && upstreamFlags.includes('--ads')) continue;
      if (flag === '--verbose' || flag === '--ads') continue; // These are always present
      flagChecks.push({ command: cmd, flag, status: 'error', message: 'Flag wurde in der neuen Version entfernt' });
    }
  }

  // Schema checks — fetch ad.schema.json and config.schema.json in parallel
  const schemaChecks: SchemaCheck[] = [];
  const [adSchema, configSchema] = await Promise.all([
    fetchSchema('ad.schema.json'),
    fetchSchema('config.schema.json'),
  ]);

  if (adSchema) {
    schemaChecks.push(...compareSchemaFields('ad', adSchema, GUI_AD_FIELDS));
  }
  if (configSchema) {
    schemaChecks.push(...compareSchemaFields('config', configSchema, GUI_CONFIG_SECTIONS));
  }

  const allChecks = [...commandChecks, ...flagChecks, ...schemaChecks];
  const hasErrors = allChecks.some(c => c.status === 'error');
  const hasWarnings = allChecks.some(c => c.status === 'warning');
  const errorCount = allChecks.filter(c => c.status === 'error').length;
  const warningCount = allChecks.filter(c => c.status === 'warning').length;

  let overallStatus: CheckStatus = 'ok';
  let summary = `GUI ist kompatibel mit der neuen Version ${version} — Update sicher`;

  if (hasErrors) {
    overallStatus = 'error';
    summary = `${errorCount} Inkompatibilität${errorCount > 1 ? 'en' : ''} mit ${version} — Update würde GUI beeinträchtigen`;
  } else if (hasWarnings) {
    overallStatus = 'warning';
    summary = `Update auf ${version} sicher — ${warningCount} neue${warningCount > 1 ? '' : 's'} Feature${warningCount > 1 ? 's' : ''}, die die GUI noch nicht nutzt`;
  }

  return { botVersion: version, overallStatus, commands: commandChecks, flags: flagChecks, schemas: schemaChecks, summary };
}
