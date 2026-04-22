import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { setupSchema } from '@/validation/schemas';
import { hashPassword } from '@/lib/auth/password';
import { createJwt } from '@/lib/auth/jwt';
import {
  loadUsers,
  saveUsers,
  isMultiUser,
  generateUserId,
  createUserWorkspace,
} from '@/lib/yaml/users';
import { buildConfig, buildServerConfig, readConfig, writeConfig } from '@/lib/yaml/config';
import { BOT_DIR } from '@/lib/bot/runner';
import { ensureExtensionsDir } from '@/lib/bot/cdp-scripts';
import { setupLimiter } from '@/lib/auth/rate-limiter';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    // Rate limit setup attempts by IP to prevent brute-force account creation
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    setupLimiter.check(clientIp);

    // Check if setup is already completed
    if (isMultiUser()) {
      const usersData = loadUsers();
      if (usersData && usersData.users.length > 0) {
        return NextResponse.json(
          { detail: 'Setup already completed. Users already exist.' },
          { status: 409 },
        );
      }
    }

    const body = await request.json().catch(() => ({}));
    const parsed = setupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const data = parsed.data;

    // Create admin user
    const userId = generateUserId(data.email);
    const passwordHash = await hashPassword(data.web_password);
    const now = new Date().toISOString();

    const newUser = {
      id: userId,
      email: data.email,
      password_hash: passwordHash,
      role: 'admin' as const,
      display_name: data.display_name || data.contact_name || data.email.split('@')[0],
      created_at: now,
    };

    const secret = crypto.randomBytes(32).toString('hex');
    const usersData = {
      jwt_secret: secret,
      users: [newUser],
      invites: [],
    };
    saveUsers(usersData);

    // Ensure root server config exists with browser/ai/publishing settings before
    // writing user config — in single-user mode ws === BOT_DIR, so we must write
    // the full server config first to avoid the user config overwriting browser settings.
    const existingRoot = readConfig(BOT_DIR);
    if (!Object.keys(existingRoot).length) {
      writeConfig(BOT_DIR, buildServerConfig(data));
    } else if (data.openrouter_api_key) {
      const ai = (existingRoot.ai as Record<string, unknown>) ?? {};
      ai.api_key = data.openrouter_api_key;
      existingRoot.ai = ai;
      writeConfig(BOT_DIR, existingRoot);
    }

    // Create workspace and user config (login, ad_defaults).
    // In single-user mode ws === BOT_DIR — merge into the root config instead of
    // replacing it, so browser/ai/publishing settings written above are preserved.
    const ws = createUserWorkspace(userId);
    const userConfig = buildConfig(data);
    if (ws === BOT_DIR) {
      const rootConfig = readConfig(BOT_DIR);
      writeConfig(ws, { ...rootConfig, ...userConfig });
    } else {
      writeConfig(ws, userConfig);
    }

    // Create extensions directory and config template if missing
    ensureExtensionsDir();

    const token = createJwt(newUser, secret);

    return NextResponse.json({
      status: 'ok',
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        role: newUser.role,
        display_name: newUser.display_name,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
