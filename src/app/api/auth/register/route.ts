import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { registerSchema } from '@/validation/schemas';
import { loadUsers, saveUsers, ensureJwtSecret, generateUserId, createUserWorkspace, isSingleUser, migrateOwnerToMultiUser } from '@/lib/yaml/users';
import { hashPassword } from '@/lib/auth/password';
import { createJwt } from '@/lib/auth/jwt';
import { RateLimiter } from '@/lib/auth/rate-limiter';
import { loadBotDefaults, writeConfig } from '@/lib/yaml/config';
import crypto from 'crypto';

const registerLimiter = new RateLimiter(5, 600);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const { email, password, display_name, invite_token } = parsed.data;

    // Rate limit by IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    registerLimiter.check(clientIp);

    const data = (await loadUsers()) ?? { users: [], invites: [] };
    const users = data.users ?? [];
    const invites = data.invites ?? [];

    // Check email uniqueness
    if (users.some((u) => u.email === email)) {
      return NextResponse.json({ detail: 'Email already registered' }, { status: 409 });
    }

    // Validate invite token
    if (!invite_token) {
      return NextResponse.json({ detail: 'Invite token required' }, { status: 400 });
    }
    const tokenHash = crypto.createHash('sha256').update(invite_token).digest('hex');
    const inviteIdx = invites.findIndex((i) => i.token_hash === tokenHash);
    if (inviteIdx === -1) {
      return NextResponse.json(
        { detail: 'Invalid or already used invite token' },
        { status: 400 },
      );
    }
    const invite = invites[inviteIdx];
    if (new Date() > new Date(invite.expires_at)) {
      return NextResponse.json({ detail: 'Invite token expired' }, { status: 400 });
    }
    invites.splice(inviteIdx, 1);

    // Create user
    const userId = generateUserId(email);
    const newUser = {
      id: userId,
      email,
      password_hash: await hashPassword(password),
      role: 'user' as const,
      display_name: display_name || email.split('@')[0],
      created_at: new Date().toISOString(),
    };
    users.push(newUser);
    data.users = users;
    data.invites = invites;
    // Check if transitioning from single to multi-user
    const wasOwnerAlone = users.length === 2; // just added the 2nd user
    const ownerId = users[0]?.id;

    const secret = await ensureJwtSecret(data);
    await saveUsers(data);

    // Migrate owner data from root to users/<owner>/ if this is the first additional user
    if (wasOwnerAlone && ownerId) {
      migrateOwnerToMultiUser(ownerId);
    }

    // Create workspace for new user
    const ws = createUserWorkspace(userId);

    // User config: only login + ad_defaults (server config stays on root).
    // Use live bot defaults as base for ad_defaults so new bot fields are included.
    const botDefaults = loadBotDefaults();
    const userConfig = {
      login: {
        username: email,
        password,
      },
      ad_defaults: {
        ...(botDefaults.ad_defaults as Record<string, unknown>),
        contact: {
          name: display_name || email.split('@')[0],
          street: '',
          zipcode: '',
          location: '',
          phone: '',
        },
      },
    };
    writeConfig(ws, userConfig);

    const token = await createJwt(newUser, secret);
    return NextResponse.json({
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
