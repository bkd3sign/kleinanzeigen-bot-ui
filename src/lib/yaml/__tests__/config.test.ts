import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { readConfig, writeConfig, buildConfig, buildServerConfig, BROWSER_DEFAULTS, applyProductDefaults, isEnvPlaceholder } from '../config';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readConfig', () => {
  it('reads YAML config', () => {
    const configPath = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(
      configPath,
      'login:\n  username: user@test.de\n  password: secret\n',
      'utf-8',
    );

    const config = readConfig(tmpDir);
    const login = config.login as Record<string, unknown>;
    expect(login.username).toBe('user@test.de');
    expect(login.password).toBe('secret');
  });

  it('returns empty object when config does not exist', () => {
    const config = readConfig(tmpDir);
    expect(config).toEqual({});
  });
});

describe('writeConfig', () => {
  it('writes YAML config that can be read back', () => {
    const data = {
      login: { username: 'test@test.de', password: 'pass' },
      browser: { headless: true },
    };

    writeConfig(tmpDir, data);

    const configPath = path.join(tmpDir, 'config.yaml');
    expect(fs.existsSync(configPath)).toBe(true);

    const readBack = readConfig(tmpDir);
    expect((readBack.login as Record<string, unknown>).username).toBe('test@test.de');
  });
});

describe('buildConfig', () => {
  it('produces correct user config with login and ad_defaults', () => {
    const data = {
      username: 'user@example.de',
      password: 'secret123',
      contact_name: 'Max',
      contact_zipcode: '10115',
      contact_location: 'Berlin',
      email: 'user@example.de',
      web_password: 'webpass',
    };

    const config = buildConfig(data);

    // Login section
    const login = config.login as Record<string, unknown>;
    expect(login.username).toBe('user@example.de');
    expect(login.password).toBe('secret123');

    // Ad defaults section
    const adDefaults = config.ad_defaults as Record<string, unknown>;
    expect(adDefaults.active).toBe(true);
    expect(adDefaults.type).toBe('OFFER');
    expect(adDefaults.price_type).toBe('NEGOTIABLE');
    expect(adDefaults.shipping_type).toBe('SHIPPING');
    expect(adDefaults.republication_interval).toBe(7);

    // Contact within ad_defaults
    const contact = adDefaults.contact as Record<string, unknown>;
    expect(contact.name).toBe('Max');
    expect(contact.zipcode).toBe('10115');
    expect(contact.location).toBe('Berlin');

    // User config should NOT contain browser (that's server config)
    expect(config.browser).toBeUndefined();
  });

  it('buildServerConfig includes browser and AI defaults', () => {
    const data = {
      username: 'user@example.de',
      password: 'secret123',
      email: 'user@example.de',
      web_password: 'webpass',
      openrouter_api_key: 'sk-test-123',
    };

    const config = buildServerConfig(data);

    expect(config.browser).toBeDefined();
    const ai = config.ai as Record<string, unknown>;
    expect(ai.api_key).toBe('sk-test-123');
    expect(ai.model).toBeDefined();
    expect(ai.prompt).toBeDefined();
  });

  it('handles missing optional contact fields', () => {
    const data = {
      username: 'user@example.de',
      password: 'secret',
      email: 'user@example.de',
      web_password: 'webpass',
    };

    const config = buildConfig(data);
    const adDefaults = config.ad_defaults as Record<string, unknown>;
    const contact = adDefaults.contact as Record<string, unknown>;
    expect(contact.name).toBe('');
    expect(contact.zipcode).toBe('');
    expect(contact.location).toBe('');
  });
});

describe('BROWSER_DEFAULTS', () => {
  it('has expected keys', () => {
    expect(BROWSER_DEFAULTS).toHaveProperty('arguments');
    expect(BROWSER_DEFAULTS).toHaveProperty('binary_location');
    expect(BROWSER_DEFAULTS).toHaveProperty('use_private_window');
    expect(BROWSER_DEFAULTS).toHaveProperty('extensions');
    expect(BROWSER_DEFAULTS).toHaveProperty('user_data_dir');
    expect(BROWSER_DEFAULTS).toHaveProperty('profile_name');
  });

  it('has headless in arguments', () => {
    const args = BROWSER_DEFAULTS.arguments as string[];
    expect(args).toContain('--headless=new');
    expect(args).toContain('--no-sandbox');
  });

  it('has use_private_window set to false (warm session needs a persistent profile)', () => {
    expect(BROWSER_DEFAULTS.use_private_window).toBe(false);
  });
});

describe('applyProductDefaults', () => {
  it('defaults local_path_renaming.mode to TEMPLATE_MATCH when absent', () => {
    const result = applyProductDefaults({});
    expect((result.publishing as Record<string, Record<string, unknown>>).local_path_renaming.mode)
      .toBe('TEMPLATE_MATCH');
  });

  it('overrides the bot default OFF with TEMPLATE_MATCH (defaults layer)', () => {
    const botDefaults = { publishing: { local_path_renaming: { mode: 'OFF' } } };
    const result = applyProductDefaults(botDefaults);
    expect((result.publishing as Record<string, Record<string, unknown>>).local_path_renaming.mode)
      .toBe('TEMPLATE_MATCH');
  });

  it('defaults deleting.after_delete to DISABLE when absent', () => {
    const result = applyProductDefaults({});
    expect((result.deleting as Record<string, unknown>).after_delete).toBe('DISABLE');
  });

  it('overrides the bot default NONE with DISABLE (defaults layer)', () => {
    const result = applyProductDefaults({ deleting: { after_delete: 'NONE' } });
    expect((result.deleting as Record<string, unknown>).after_delete).toBe('DISABLE');
  });

  it('preserves sibling publishing keys', () => {
    const result = applyProductDefaults({ publishing: { delete_old_ads: 'AFTER_PUBLISH' } });
    const publishing = result.publishing as Record<string, unknown>;
    expect(publishing.delete_old_ads).toBe('AFTER_PUBLISH');
    expect((publishing.local_path_renaming as Record<string, unknown>).mode).toBe('TEMPLATE_MATCH');
  });

  it('preserves unrelated top-level keys and does not mutate the input', () => {
    const input = { ad_defaults: { active: true }, publishing: { local_path_renaming: { mode: 'OFF' } } };
    const result = applyProductDefaults(input);
    expect(result.ad_defaults).toEqual({ active: true });
    // input untouched
    expect((input.publishing.local_path_renaming).mode).toBe('OFF');
  });
});

describe('isEnvPlaceholder', () => {
  it('detects a plain ${VAR} placeholder', () => {
    expect(isEnvPlaceholder('${KLEINANZEIGEN_BOT_USERNAME}')).toBe(true);
  });

  it('detects a ${VAR:-default} placeholder with fallback', () => {
    expect(isEnvPlaceholder('${KLEINANZEIGEN_BOT_PASSWORD:-changeme}')).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(isEnvPlaceholder('  ${VAR}  ')).toBe(true);
  });

  it('rejects a real email address', () => {
    expect(isEnvPlaceholder('user@test.de')).toBe(false);
  });

  it('rejects a value that only contains a placeholder among other text', () => {
    expect(isEnvPlaceholder('prefix-${VAR}')).toBe(false);
  });

  it('rejects empty, null and undefined', () => {
    expect(isEnvPlaceholder('')).toBe(false);
    expect(isEnvPlaceholder(null)).toBe(false);
    expect(isEnvPlaceholder(undefined)).toBe(false);
  });

  it('rejects a placeholder whose name starts with a digit', () => {
    expect(isEnvPlaceholder('${1VAR}')).toBe(false);
  });
});
