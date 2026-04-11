import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { slugFromName, getTemplatesDir, findTemplateFiles } from '../templates';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'templates-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('slugFromName', () => {
  it('generates correct slug from simple name', () => {
    expect(slugFromName('Test Template')).toBe('test_template');
  });

  it('lowercases input', () => {
    expect(slugFromName('My TEMPLATE')).toBe('my_template');
  });

  it('handles special characters', () => {
    expect(slugFromName('Template #1!')).toBe('template_1');
  });

  it('removes en-dash and em-dash', () => {
    expect(slugFromName('one\u2013two')).toBe('onetwo');
    expect(slugFromName('one\u2014two')).toBe('onetwo');
  });

  it('removes non-alphanumeric and non-underscore chars', () => {
    expect(slugFromName('hello@world.com')).toBe('helloworldcom');
  });

  it('truncates to 60 characters', () => {
    const longName = 'a'.repeat(100);
    expect(slugFromName(longName).length).toBeLessThanOrEqual(60);
  });

  it('handles empty string', () => {
    expect(slugFromName('')).toBe('');
  });
});

describe('getTemplatesDir', () => {
  it('returns correct path', () => {
    expect(getTemplatesDir('/workspace')).toBe(
      path.join('/workspace', 'ads', 'templates'),
    );
  });
});

describe('findTemplateFiles', () => {
  it('finds tpl_*.yaml files', () => {
    const templatesDir = path.join(tmpDir, 'ads', 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.writeFileSync(path.join(templatesDir, 'tpl_basic.yaml'), 'title: Basic\n');
    fs.writeFileSync(path.join(templatesDir, 'tpl_advanced.yaml'), 'title: Advanced\n');

    const files = findTemplateFiles(tmpDir);
    expect(files).toHaveLength(2);
    expect(files[0]).toContain('tpl_advanced.yaml');
    expect(files[1]).toContain('tpl_basic.yaml');
  });

  it('ignores non-template files', () => {
    const templatesDir = path.join(tmpDir, 'ads', 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.writeFileSync(path.join(templatesDir, 'tpl_valid.yaml'), 'title: Valid\n');
    fs.writeFileSync(path.join(templatesDir, 'ad_not_tpl.yaml'), 'title: Ad\n');
    fs.writeFileSync(path.join(templatesDir, 'readme.txt'), 'notes\n');

    const files = findTemplateFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('tpl_valid.yaml');
  });

  it('creates templates directory if not existing', () => {
    const templatesDir = path.join(tmpDir, 'ads', 'templates');
    expect(fs.existsSync(templatesDir)).toBe(false);

    const files = findTemplateFiles(tmpDir);
    expect(files).toEqual([]);
    expect(fs.existsSync(templatesDir)).toBe(true);
  });

  it('returns sorted results', () => {
    const templatesDir = path.join(tmpDir, 'ads', 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.writeFileSync(path.join(templatesDir, 'tpl_zebra.yaml'), 'title: Z\n');
    fs.writeFileSync(path.join(templatesDir, 'tpl_alpha.yaml'), 'title: A\n');

    const files = findTemplateFiles(tmpDir);
    expect(files[0]).toContain('tpl_alpha.yaml');
    expect(files[1]).toContain('tpl_zebra.yaml');
  });
});
