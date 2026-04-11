import path from 'path';
import fs from 'fs';

// Allowed top-level bot commands (prevents arbitrary command injection via schedules)
const ALLOWED_BOT_COMMANDS = new Set([
  'publish',
  'verify',
  'delete',
  'update',
  'download',
  'extend',
  'update-check',
  'update-content-hash',
]);

/**
 * Validate a bot command string against the allowed command whitelist.
 * Only the first token (the command name) is checked; flags are allowed after it.
 */
export function validateBotCommand(command: string): void {
  const base = command.trim().split(/\s+/)[0] ?? '';
  if (!ALLOWED_BOT_COMMANDS.has(base)) {
    throw new ApiError(
      400,
      `Invalid bot command: '${base}'. Allowed: ${Array.from(ALLOWED_BOT_COMMANDS).sort().join(', ')}.`,
    );
  }
}

// Valid keywords for the --ads CLI flag
const VALID_ADS_VALUES = new Set(['all', 'due', 'new', 'changed']);

// Regex: comma-separated numeric IDs
const ADS_ID_PATTERN = /^\d+(?:,\d+)*$/;

/**
 * Validate the --ads parameter to prevent command injection.
 * Allows: known keywords (all, due, new, changed) or comma-separated numeric IDs.
 */
export function validateAdsParam(
  ads: string,
  allowedKeywords: Set<string> = VALID_ADS_VALUES,
): string {
  const trimmed = ads.trim();
  if (!trimmed) {
    throw new ApiError(400, "'ads' parameter must not be empty");
  }
  if (allowedKeywords.has(trimmed)) {
    return trimmed;
  }
  if (ADS_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const allowed = Array.from(allowedKeywords).sort().join(', ');
  throw new ApiError(
    400,
    `Invalid 'ads' value: '${trimmed}'. Allowed: ${allowed} or comma-separated numeric IDs.`,
  );
}

/**
 * Generate a safe user ID from email — alphanumeric, dots, hyphens, underscores only.
 */
export function sanitizeUserId(email: string): string {
  let safeId = email.toLowerCase().trim();
  // Replace @ and other unsafe chars with underscore
  safeId = safeId.replace(/[^a-z0-9._-]/g, '_');
  // Prevent path traversal
  safeId = safeId.replace(/\.\./g, '_').replace(/^[._-]+|[._-]+$/g, '');
  if (!safeId) {
    throw new ApiError(400, 'Invalid email for user ID generation');
  }
  return safeId;
}

/**
 * Ensure resolved path is within root directory. Raises 403 on traversal attempt.
 */
export function validatePathWithin(targetPath: string, root: string): string {
  const resolved = path.resolve(targetPath);
  const resolvedRoot = path.resolve(root);
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    throw new ApiError(403, 'Access denied: path traversal detected');
  }
  return resolved;
}

/**
 * Lightweight API error with HTTP status code.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
