import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { loadUsers, saveUsers, generateUserId, createUserWorkspace } from '@/lib/yaml/users';
import { readMergedConfig } from '@/lib/yaml/config';

import { hashPassword } from '@/lib/auth/password';
import { jobs } from '@/lib/bot/jobs';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const BOT_DIR = process.env.BOT_DIR || process.cwd();

export async function GET(request: NextRequest) {
  try {
    const existingUsers = loadUsers();
    const usersExist = !!existingUsers && existingUsers.users.length > 0;
    let setupRequired = true;
    let userInfo = null;
    let configReady = false;
    let autoMigrated = false;
    let userWorkspace = '';

    // Auto-migration: existing config.yaml with login but no users.yaml
    if (!usersExist) {
      const rootConfigPath = path.join(BOT_DIR, 'config.yaml');
      if (fs.existsSync(rootConfigPath)) {
        const cfg = yaml.load(fs.readFileSync(rootConfigPath, 'utf-8')) as Record<string, unknown> || {};
        const login = (cfg.login as Record<string, string>) || {};
        const username = login.username || '';
        const password = login.password || '';

        if (username && password) {
          const userId = generateUserId(username);
          const adDefaults = (cfg.ad_defaults as Record<string, unknown>) || {};
          const contact = (adDefaults.contact as Record<string, string>) || {};

          const newUser = {
            id: userId,
            email: username,
            password_hash: await hashPassword(password),
            role: 'admin' as const,
            display_name: contact.name || username.split('@')[0],
            created_at: new Date().toISOString(),
          };

          const usersData = {
            jwt_secret: require('crypto').randomBytes(32).toString('hex'),
            users: [newUser],
            invites: [],
          };
          saveUsers(usersData);

          // Create user workspace
          const ws = createUserWorkspace(userId);
          const userKeys = new Set(['login', 'ad_defaults']);
          const userCfg: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(cfg)) {
            if (userKeys.has(k)) userCfg[k] = v;
          }
          fs.writeFileSync(
            path.join(ws, 'config.yaml'),
            yaml.dump(userCfg, { flowLevel: -1 }),
          );

          // Strip user-specific data from root config
          for (const key of userKeys) {
            delete cfg[key];
          }
          fs.writeFileSync(rootConfigPath, yaml.dump(cfg, { flowLevel: -1 }));

          // Move ads/ and downloaded-ads/ to user workspace
          for (const dir of ['ads', 'downloaded-ads']) {
            const src = path.join(BOT_DIR, dir);
            const dest = path.join(ws, dir);
            if (fs.existsSync(src)) {
              try {
                fs.renameSync(src, dest);
              } catch {
                // Cross-filesystem: copy then delete
                fs.cpSync(src, dest, { recursive: true });
                fs.rmSync(src, { recursive: true, force: true });
              }
            }
          }

          autoMigrated = true;
        }
      }
    }

    const data = loadUsers();
    const users = data?.users || [];
    if (users.length > 0) {
      setupRequired = false;

      // Try to authenticate (optional)
      try {
        const user = await getCurrentUser(request);
        userInfo = { email: user.email, role: user.role, display_name: user.display_name };
        userWorkspace = user.workspace;
        const wsConfigPath = path.join(user.workspace, 'config.yaml');
        if (fs.existsSync(wsConfigPath)) {
          const cfg = yaml.load(fs.readFileSync(wsConfigPath, 'utf-8')) as Record<string, unknown> || {};
          const login = (cfg.login as Record<string, string>) || {};
          configReady = !!login.username && !!login.password;
        }
      } catch (error) {
        // Not authenticated — ok for health
      }
    }

    const result: Record<string, unknown> = {
      status: 'ok',
      setup_required: setupRequired,
      config_ready: configReady,
    };

    // Only expose running_jobs and ai_configured to authenticated users
    if (userInfo) {
      const runningJobs = Array.from(jobs.values()).filter((j) => j.status === 'running').length;
      result.running_jobs = runningJobs;

      const mergedCfg = readMergedConfig(userWorkspace);
      const aiCfg = (mergedCfg?.ai as Record<string, string>) ?? {};
      result.ai_configured = !!(aiCfg.api_key ?? process.env.OPENROUTER_API_KEY);
    }

    if (userInfo) result.user = userInfo;
    if (autoMigrated) result.auto_migrated = true;

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ status: 'ok', setup_required: true, config_ready: false, running_jobs: 0, ai_configured: false });
  }
}
