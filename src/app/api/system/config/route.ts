import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { configUpdateSchema } from '@/validation/schemas';
import { getCurrentUser } from '@/lib/auth/middleware';
import { readMergedConfig, writeUserConfig } from '@/lib/yaml/config';
import { loadUsers, saveUsers } from '@/lib/yaml/users';
import { hashPassword } from '@/lib/auth/password';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const config = readMergedConfig(user.workspace);
    if (!Object.keys(config).length) {
      return NextResponse.json({});
    }

    const login = (config.login as Record<string, string>) ?? {};
    return NextResponse.json({
      ad_defaults: config.ad_defaults ?? {},
      publishing: config.publishing ?? {},
      timeouts: config.timeouts ?? {},
      download: config.download ?? {},
      update_check: config.update_check ?? {},
      login: {
        username: login.username ?? '',
        password: login.password ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = configUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const updates = parsed.data as Record<string, unknown>;

    // Protect password: restore original if masked or empty
    if (updates.login) {
      const loginUpdate = updates.login as Record<string, string>;
      const isMasked = loginUpdate.password === '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
      const isEmpty = !loginUpdate.password;
      if (isMasked || isEmpty) {
        const currentConfig = readMergedConfig(user.workspace);
        const currentLogin = (currentConfig.login ?? {}) as Record<string, string>;
        loginUpdate.password = currentLogin.password ?? '';
      }
    }

    // Detect if password was actually changed (not masked, not empty)
    const passwordChanged = updates.login
      && (updates.login as Record<string, string>).password
      && (updates.login as Record<string, string>).password !== '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
    const newPassword = passwordChanged ? (updates.login as Record<string, string>).password : null;

    // Write config (auto-splits user vs server keys in multi-user mode)
    writeUserConfig(user.workspace, updates);

    // Sync password change to app login (users.yaml)
    if (newPassword) {
      const usersData = loadUsers();
      if (usersData) {
        const userEntry = usersData.users.find((u) => u.id === user.id);
        if (userEntry) {
          userEntry.password_hash = await hashPassword(newPassword);
          saveUsers(usersData);
        }
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    return handleApiError(error);
  }
}
