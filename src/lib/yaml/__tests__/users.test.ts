import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import type { UsersData } from '@/types/auth';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'users-test-'));
  process.env.BOT_DIR = tmpDir;
  // Reset module cache so users.ts picks up new BOT_DIR
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.BOT_DIR;
});

async function importUsers() {
  const mod = await import('../users');
  return mod;
}

function writeUsersYaml(data: UsersData) {
  fs.writeFileSync(
    path.join(tmpDir, 'users.yaml'),
    yaml.dump(data, { flowLevel: -1 }),
  );
}

function readUsersYaml(): UsersData {
  const content = fs.readFileSync(path.join(tmpDir, 'users.yaml'), 'utf-8');
  return yaml.load(content) as UsersData;
}

const MOCK_USERS_DATA: UsersData = {
  jwt_secret: 'test-secret-123',
  users: [
    {
      id: 'test_user',
      email: 'test@example.com',
      password_hash: '$2a$10$abcdef',
      role: 'admin',
      display_name: 'Test User',
      created_at: '2026-01-01T00:00:00Z',
    },
  ],
  invites: [],
};

describe('generateUserId', () => {
  it('converts email to safe directory name', async () => {
    const { generateUserId } = await importUsers();
    const id = generateUserId('test@example.com');
    expect(id).toBeTruthy();
    expect(id).not.toContain('/');
    expect(id).not.toContain('..');
  });

  it('produces consistent output', async () => {
    const { generateUserId } = await importUsers();
    const a = generateUserId('user@test.de');
    const b = generateUserId('user@test.de');
    expect(a).toBe(b);
  });
});

describe('loadUsers', () => {
  it('returns null when users.yaml does not exist', async () => {
    const { loadUsers } = await importUsers();
    expect(loadUsers()).toBeNull();
  });

  it('reads and parses users.yaml', async () => {
    writeUsersYaml(MOCK_USERS_DATA);
    const { loadUsers } = await importUsers();
    const data = loadUsers();
    expect(data).not.toBeNull();
    expect(data!.users).toHaveLength(1);
    expect(data!.users[0].email).toBe('test@example.com');
    expect(data!.jwt_secret).toBe('test-secret-123');
  });
});

describe('saveUsers', () => {
  it('writes users.yaml', async () => {
    const { saveUsers } = await importUsers();
    saveUsers(MOCK_USERS_DATA);
    expect(fs.existsSync(path.join(tmpDir, 'users.yaml'))).toBe(true);
    const saved = readUsersYaml();
    expect(saved.users).toHaveLength(1);
    expect(saved.jwt_secret).toBe('test-secret-123');
  });
});

describe('ensureJwtSecret', () => {
  it('returns existing secret without modifying', async () => {
    writeUsersYaml(MOCK_USERS_DATA);
    const { ensureJwtSecret } = await importUsers();
    const secret = ensureJwtSecret(MOCK_USERS_DATA);
    expect(secret).toBe('test-secret-123');
  });

  it('generates and persists secret when missing', async () => {
    const data: UsersData = { users: [], invites: [] };
    writeUsersYaml(data);
    const { ensureJwtSecret } = await importUsers();
    const secret = ensureJwtSecret(data);
    expect(secret).toBeTruthy();
    expect(secret.length).toBe(64); // 32 bytes hex
    // Verify it was saved to disk
    const saved = readUsersYaml();
    expect(saved.jwt_secret).toBe(secret);
  });
});

describe('isSingleUser / isMultiUser', () => {
  it('single user when no users.yaml', async () => {
    const { isSingleUser, isMultiUser } = await importUsers();
    expect(isSingleUser()).toBe(true);
    expect(isMultiUser()).toBe(false);
  });

  it('single user with one user', async () => {
    writeUsersYaml(MOCK_USERS_DATA);
    const { isSingleUser, isMultiUser } = await importUsers();
    expect(isSingleUser()).toBe(true);
    expect(isMultiUser()).toBe(false);
  });

  it('multi user with two users', async () => {
    const data: UsersData = {
      ...MOCK_USERS_DATA,
      users: [
        MOCK_USERS_DATA.users[0],
        { id: 'user2', email: 'user2@test.de', password_hash: '$2a$10$xyz', role: 'user', display_name: 'User 2', created_at: '2026-01-02T00:00:00Z' },
      ],
    };
    writeUsersYaml(data);
    const { isSingleUser, isMultiUser } = await importUsers();
    expect(isSingleUser()).toBe(false);
    expect(isMultiUser()).toBe(true);
  });
});

describe('createUserWorkspace', () => {
  it('creates workspace directories', async () => {
    // Need multi-user mode for workspace isolation
    const data: UsersData = {
      ...MOCK_USERS_DATA,
      users: [
        MOCK_USERS_DATA.users[0],
        { id: 'user2', email: 'user2@test.de', password_hash: '$2a$10$xyz', role: 'user', display_name: 'User 2', created_at: '2026-01-02T00:00:00Z' },
      ],
    };
    writeUsersYaml(data);
    const { createUserWorkspace } = await importUsers();
    const ws = createUserWorkspace('newuser');
    expect(fs.existsSync(path.join(ws, 'ads', 'templates'))).toBe(true);
    expect(fs.existsSync(path.join(ws, 'downloaded-ads'))).toBe(true);
  });
});
