import { describe, it, expect } from 'vitest';
import { extractCDPPort } from '../cdp-scripts';

describe('extractCDPPort', () => {
  it('extracts port from bot WebSocket URL', () => {
    expect(extractCDPPort(
      '[INFO] Neue Browser-Sitzung ist ws://127.0.0.1:59017/devtools/browser/abc-123',
    )).toBe(59017);
  });

  it('extracts port from different port numbers', () => {
    expect(extractCDPPort('ws://127.0.0.1:9222/devtools/browser/x')).toBe(9222);
    expect(extractCDPPort('ws://127.0.0.1:61205/devtools/browser/x')).toBe(61205);
  });

  it('returns null when no match', () => {
    expect(extractCDPPort('[INFO] Überprüfe, ob bereits eingeloggt...')).toBeNull();
    expect(extractCDPPort('')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(extractCDPPort('ws://127.0.0.1:/devtools')).toBeNull();
    expect(extractCDPPort('ws://localhost:9222/devtools')).toBeNull();
  });

  it('extracts first match from multi-line output', () => {
    const output = 'line1\nws://127.0.0.1:1234/devtools/browser/a\nws://127.0.0.1:5678/devtools/browser/b';
    expect(extractCDPPort(output)).toBe(1234);
  });
});
