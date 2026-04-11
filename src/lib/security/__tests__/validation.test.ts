import { describe, it, expect } from 'vitest';
import { validateAdsParam, sanitizeUserId, validatePathWithin, ApiError } from '../validation';

describe('validateAdsParam', () => {
  it('accepts valid keyword "all"', () => {
    expect(validateAdsParam('all')).toBe('all');
  });

  it('accepts valid keyword "due"', () => {
    expect(validateAdsParam('due')).toBe('due');
  });

  it('accepts valid keyword "new"', () => {
    expect(validateAdsParam('new')).toBe('new');
  });

  it('accepts valid keyword "changed"', () => {
    expect(validateAdsParam('changed')).toBe('changed');
  });

  it('accepts single numeric ID', () => {
    expect(validateAdsParam('123')).toBe('123');
  });

  it('accepts comma-separated numeric IDs', () => {
    expect(validateAdsParam('123,456')).toBe('123,456');
  });

  it('accepts multiple comma-separated IDs', () => {
    expect(validateAdsParam('1,2,3,4,5')).toBe('1,2,3,4,5');
  });

  it('trims whitespace from valid input', () => {
    expect(validateAdsParam('  all  ')).toBe('all');
  });

  it('rejects empty string', () => {
    expect(() => validateAdsParam('')).toThrow(ApiError);
    expect(() => validateAdsParam('')).toThrow("'ads' parameter must not be empty");
  });

  it('rejects whitespace-only string', () => {
    expect(() => validateAdsParam('   ')).toThrow(ApiError);
    expect(() => validateAdsParam('   ')).toThrow("'ads' parameter must not be empty");
  });

  it('rejects semicolon (shell injection)', () => {
    expect(() => validateAdsParam('; rm -rf /')).toThrow(ApiError);
  });

  it('rejects && (shell injection)', () => {
    expect(() => validateAdsParam('all && cat /etc/passwd')).toThrow(ApiError);
  });

  it('rejects pipe (shell injection)', () => {
    expect(() => validateAdsParam('all | cat /etc/passwd')).toThrow(ApiError);
  });

  it('rejects backticks (shell injection)', () => {
    expect(() => validateAdsParam('`whoami`')).toThrow(ApiError);
  });

  it('rejects $() command substitution (shell injection)', () => {
    expect(() => validateAdsParam('$(whoami)')).toThrow(ApiError);
  });

  it('rejects newline (shell injection)', () => {
    expect(() => validateAdsParam('all\nrm -rf /')).toThrow(ApiError);
  });

  it('rejects tab character', () => {
    expect(() => validateAdsParam('all\trm')).toThrow(ApiError);
  });

  it('rejects unknown keywords', () => {
    expect(() => validateAdsParam('unknown')).toThrow(ApiError);
  });

  it('rejects mixed text with IDs', () => {
    expect(() => validateAdsParam('abc,123')).toThrow(ApiError);
  });

  it('supports custom allowed keywords', () => {
    const custom = new Set(['custom', 'test']);
    expect(validateAdsParam('custom', custom)).toBe('custom');
    expect(validateAdsParam('test', custom)).toBe('test');
    // Default keywords should not work with custom set
    expect(() => validateAdsParam('all', custom)).toThrow(ApiError);
  });

  it('error message lists allowed keywords', () => {
    try {
      validateAdsParam('invalid');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(400);
      expect((err as ApiError).message).toContain('all');
      expect((err as ApiError).message).toContain('comma-separated numeric IDs');
    }
  });
});

describe('sanitizeUserId', () => {
  it('converts normal email to safe ID', () => {
    const result = sanitizeUserId('user@example.com');
    expect(result).toBe('user_example.com');
  });

  it('lowercases input', () => {
    const result = sanitizeUserId('User@Example.COM');
    expect(result).toBe('user_example.com');
  });

  it('strips unsafe characters like $', () => {
    const result = sanitizeUserId('user$name@example.com');
    expect(result).toBe('user_name_example.com');
  });

  it('strips spaces', () => {
    const result = sanitizeUserId('user name@example.com');
    expect(result).toBe('user_name_example.com');
  });

  it('prevents double dots (path traversal)', () => {
    const result = sanitizeUserId('user..admin@example.com');
    expect(result).not.toContain('..');
  });

  it('prevents slashes', () => {
    const result = sanitizeUserId('user/admin@example.com');
    expect(result).not.toContain('/');
  });

  it('blocks path traversal via ../..', () => {
    const result = sanitizeUserId('../../etc/passwd');
    expect(result).not.toContain('..');
    expect(result).not.toContain('/');
  });

  it('strips leading dots and underscores', () => {
    const result = sanitizeUserId('.hidden@example.com');
    expect(result).not.toMatch(/^\./);
  });

  it('throws on input that sanitizes to empty string', () => {
    expect(() => sanitizeUserId('$$$')).toThrow(ApiError);
    expect(() => sanitizeUserId('$$$')).toThrow('Invalid email for user ID generation');
  });

  it('preserves hyphens', () => {
    const result = sanitizeUserId('user-name@example.com');
    expect(result).toContain('-');
  });

  it('preserves dots in domain', () => {
    const result = sanitizeUserId('user@sub.example.com');
    expect(result).toContain('.');
  });
});

describe('validatePathWithin', () => {
  it('allows valid path within root', () => {
    const result = validatePathWithin('/workspace/ads/ad_test.yaml', '/workspace');
    expect(result).toBe('/workspace/ads/ad_test.yaml');
  });

  it('allows root itself', () => {
    const result = validatePathWithin('/workspace', '/workspace');
    expect(result).toBe('/workspace');
  });

  it('blocks path traversal with ../', () => {
    expect(() => validatePathWithin('/workspace/ads/../../etc/passwd', '/workspace')).toThrow(
      ApiError,
    );
  });

  it('throws 403 on traversal', () => {
    try {
      validatePathWithin('/workspace/../outside', '/workspace');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).statusCode).toBe(403);
      expect((err as ApiError).message).toContain('path traversal');
    }
  });

  it('blocks absolute path outside root', () => {
    expect(() => validatePathWithin('/etc/passwd', '/workspace')).toThrow(ApiError);
  });

  it('resolves relative path components', () => {
    // /workspace/ads/../ads/file.yaml resolves to /workspace/ads/file.yaml
    const result = validatePathWithin('/workspace/ads/../ads/file.yaml', '/workspace');
    expect(result).toBe('/workspace/ads/file.yaml');
  });
});

describe('ApiError', () => {
  it('has correct name and statusCode', () => {
    const err = new ApiError(404, 'Not found');
    expect(err.name).toBe('ApiError');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err).toBeInstanceOf(Error);
  });
});
