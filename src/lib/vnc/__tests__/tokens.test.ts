import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { vncToken, writeVncToken, removeVncToken, clearVncToken } from '../tokens';

let tmpDir: string;
let origBotDir: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vnc-tokens-test-'));
  origBotDir = process.env.BOT_DIR;
  process.env.BOT_DIR = tmpDir;

  // Reset the CSPRNG token cache between tests so each test starts fresh
  const g = globalThis as unknown as { __vncTokens?: Map<string, string> };
  if (g.__vncTokens) g.__vncTokens.clear();
});

afterEach(() => {
  if (origBotDir === undefined) {
    delete process.env.BOT_DIR;
  } else {
    process.env.BOT_DIR = origBotDir;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('vncToken', () => {
  it('is stable — same workspace returns the same token within a process', () => {
    expect(vncToken('/ws/a')).toBe(vncToken('/ws/a'));
  });

  it('is a 48-character lowercase hex string', () => {
    const token = vncToken('/ws/a');
    expect(token).toMatch(/^[0-9a-f]{48}$/);
  });

  it('produces different tokens for different workspaces', () => {
    expect(vncToken('/ws/a')).not.toBe(vncToken('/ws/b'));
  });

  it('clearVncToken evicts the cache so the next call returns a fresh token', () => {
    const before = vncToken('/ws/a');
    clearVncToken('/ws/a');
    const after = vncToken('/ws/a');
    expect(after).not.toBe(before);
  });
});

describe('writeVncToken', () => {
  it('creates the token dir and writes the token file with correct content', () => {
    writeVncToken('abc', 5990);
    const tokenPath = path.join(tmpDir, '.temp', 'vnc-tokens', 'abc');
    expect(fs.existsSync(tokenPath)).toBe(true);
    expect(fs.readFileSync(tokenPath, 'utf8')).toBe('abc: 127.0.0.1:5990\n');
  });

  it('creates parent dirs recursively if they do not exist', () => {
    // tmpDir is fresh, so .temp/vnc-tokens does not exist yet
    writeVncToken('xyz', 5991);
    const tokenPath = path.join(tmpDir, '.temp', 'vnc-tokens', 'xyz');
    expect(fs.existsSync(tokenPath)).toBe(true);
  });

  it('creates the token directory with mode 0o700', () => {
    writeVncToken('perm-test', 5992);
    const dir = path.join(tmpDir, '.temp', 'vnc-tokens');
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('creates the token file with mode 0o600', () => {
    writeVncToken('perm-test', 5992);
    const file = path.join(tmpDir, '.temp', 'vnc-tokens', 'perm-test');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe('removeVncToken', () => {
  it('deletes an existing token file', () => {
    writeVncToken('abc', 5990);
    const tokenPath = path.join(tmpDir, '.temp', 'vnc-tokens', 'abc');
    expect(fs.existsSync(tokenPath)).toBe(true);
    removeVncToken('abc');
    expect(fs.existsSync(tokenPath)).toBe(false);
  });

  it('does not throw when the token file is absent', () => {
    expect(() => removeVncToken('missing')).not.toThrow();
  });
});
