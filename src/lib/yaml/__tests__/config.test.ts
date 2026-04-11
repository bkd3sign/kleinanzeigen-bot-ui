import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { readConfig, writeConfig, buildConfig, buildServerConfig, BROWSER_DEFAULTS } from '../config';

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

  it('has use_private_window set to true', () => {
    expect(BROWSER_DEFAULTS.use_private_window).toBe(true);
  });
});
