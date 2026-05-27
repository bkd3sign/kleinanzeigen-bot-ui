import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveExistingPath } from '../resolve-path';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-path-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('resolveExistingPath', () => {
  it('returns the exact path when it exists', () => {
    const p = path.join(tmp, 'plain.txt');
    fs.writeFileSync(p, 'x');
    expect(resolveExistingPath(p)).toBe(p);
  });

  it('returns null when nothing matches', () => {
    expect(resolveExistingPath(path.join(tmp, 'missing.txt'))).toBeNull();
  });

  it('finds an NFD file when given NFC path', () => {
    const nfdName = 'ä.txt'; // "ä" as a + combining diaeresis
    const nfdPath = path.join(tmp, nfdName);
    fs.writeFileSync(nfdPath, 'x');

    const nfcQuery = path.join(tmp, 'ä.txt'); // "ä" precomposed
    const resolved = resolveExistingPath(nfcQuery);
    expect(resolved).not.toBeNull();
    expect(fs.readFileSync(resolved!, 'utf-8')).toBe('x');
  });

  it('finds an NFC file when given NFD path', () => {
    const nfcName = 'ä.txt';
    const nfcPath = path.join(tmp, nfcName);
    fs.writeFileSync(nfcPath, 'x');

    const nfdQuery = path.join(tmp, 'ä.txt');
    const resolved = resolveExistingPath(nfdQuery);
    expect(resolved).not.toBeNull();
    expect(fs.readFileSync(resolved!, 'utf-8')).toBe('x');
  });

  it('handles paths with multiple Unicode segments', () => {
    const nfdFolder = 'Anhänger';
    const nfdDir = path.join(tmp, nfdFolder);
    fs.mkdirSync(nfdDir);
    fs.writeFileSync(path.join(nfdDir, 'möbel.txt'), 'x');

    const query = path.join(tmp, 'Anhänger', 'möbel.txt');
    const resolved = resolveExistingPath(query);
    expect(resolved).not.toBeNull();
  });
});
