import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { configUpdateSchema } from '@/validation/schemas';
import { getCurrentUser } from '@/lib/auth/middleware';
import { readMergedConfig, writeUserConfig, isEnvPlaceholder, USER_CONFIG_KEYS } from '@/lib/yaml/config';
import { loadUsers, saveUsers } from '@/lib/yaml/users';
import { hashPassword } from '@/lib/auth/password';
import { z } from 'zod';

const emailSchema = z.string().email();

// Placeholder the GET handler returns instead of the real password, so the
// stored credential never leaves the server. PUT treats it as "unchanged".
const MASKED_PASSWORD = '••••••••';

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
    // Per-user keys (mirrors USER_CONFIG_KEYS) — readable by everyone via the
    // Account page; the password is masked so the secret never leaves the server.
    const userPayload = {
      ad_defaults: config.ad_defaults ?? {},
      login: {
        username: login.username ?? '',
        password: login.password ? MASKED_PASSWORD : '',
      },
    };

    // Server-wide keys affect every workspace and are admin-only — non-admins
    // never receive them (same authorization contract as PUT).
    if (user.role !== 'admin') {
      return NextResponse.json(userPayload);
    }

    const ai = (config.ai as Record<string, unknown>) ?? {};
    return NextResponse.json({
      ...userPayload,
      publishing: config.publishing ?? {},
      deleting: config.deleting ?? {},
      timeouts: config.timeouts ?? {},
      download: config.download ?? {},
      update_check: config.update_check ?? {},
      diagnostics: config.diagnostics ?? {},
      // The api_key is a secret — never leave the server. Mask it like the
      // password; siblings (model, prompts, referer, app_name) pass through so
      // the client can edit and write them back without losing fields.
      ai: { ...ai, api_key: ai.api_key ? MASKED_PASSWORD : '' },
      // Browser config — only the mode field is surfaced in the UI; the full
      // object is round-tripped so sibling keys (arguments, binary_location, …)
      // are never lost on save.
      browser: config.browser ?? {},
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

    // Server-wide keys (publishing, deleting, …) live in the root config.yaml and
    // affect every workspace, so only admins may change them. The per-account keys
    // (login/ad_defaults) are editable by everyone via the Account page.
    if (user.role !== 'admin' && Object.keys(updates).some((key) => !USER_CONFIG_KEYS.has(key))) {
      return NextResponse.json(
        { detail: 'Diese Einstellungen gelten für alle Workspaces und dürfen nur von Administratoren geändert werden.' },
        { status: 403 },
      );
    }

    // Restore the stored AI api_key when the field was left masked or empty, so
    // an unchanged form never wipes the secret (same contract as the password).
    const aiUpdate = updates.ai as Record<string, unknown> | undefined;
    if (aiUpdate) {
      const submittedKey = aiUpdate.api_key;
      if (!submittedKey || submittedKey === MASKED_PASSWORD) {
        const currentAi = (readMergedConfig(user.workspace).ai ?? {}) as Record<string, unknown>;
        aiUpdate.api_key = currentAi.api_key ?? '';
      }
    }

    const loginUpdate = updates.login as Record<string, string> | undefined;

    // A real password change = client sent a non-empty, non-masked value.
    // Env-var placeholders (${VAR}) are managed by the bot, never synced to
    // the app login.
    const submittedPassword = loginUpdate?.password;
    const newPassword = submittedPassword
      && submittedPassword !== MASKED_PASSWORD
      && !isEnvPlaceholder(submittedPassword)
      ? submittedPassword
      : null;

    // Restore the stored password when the field was left masked or empty, so
    // an unchanged form never wipes the credential. A typed placeholder is kept
    // as-is (not restored), so env-var externalization survives an edit.
    if (loginUpdate && (!submittedPassword || submittedPassword === MASKED_PASSWORD)) {
      const currentLogin = (readMergedConfig(user.workspace).login ?? {}) as Record<string, string>;
      loginUpdate.password = currentLogin.password ?? '';
    }

    // The KA login (config.yaml) doubles as the GUI account login — keep both
    // 1:1 in sync. An env-var placeholder username is bot-managed: leave it in
    // config.yaml but never validate or sync it to the app login.
    const submittedUsername = loginUpdate?.username?.trim();
    const usernameIsPlaceholder = isEnvPlaceholder(submittedUsername);
    const newEmail = usernameIsPlaceholder ? undefined : submittedUsername;
    const emailChanged = !!newEmail && newEmail !== user.email;

    if (emailChanged) {
      // The username doubles as the GUI login email, which requires a valid
      // address — reject before writing so the user can't lock themselves out.
      if (!emailSchema.safeParse(newEmail).success) {
        return NextResponse.json(
          { detail: 'Ungültige E-Mail-Adresse' },
          { status: 400 },
        );
      }

      // Reject a duplicate email before writing anything, so config.yaml and
      // users.yaml can never drift apart on a rejected change.
      const existing = loadUsers();
      const collision = existing?.users.some(
        (u) => u.id !== user.id && u.email.toLowerCase() === newEmail!.toLowerCase(),
      );
      if (collision) {
        return NextResponse.json(
          { detail: 'Diese E-Mail wird bereits von einem anderen Benutzer verwendet.' },
          { status: 409 },
        );
      }
    }

    // Write config (auto-splits user vs server keys in multi-user mode)
    writeUserConfig(user.workspace, updates);

    // Sync login changes to the app account (users.yaml) so GUI + KA stay 1:1.
    if (newPassword || emailChanged) {
      const usersData = loadUsers();
      const userEntry = usersData?.users.find((u) => u.id === user.id);
      if (usersData && userEntry) {
        if (newPassword) userEntry.password_hash = await hashPassword(newPassword);
        if (emailChanged) userEntry.email = newEmail!;
        saveUsers(usersData);
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    return handleApiError(error);
  }
}
