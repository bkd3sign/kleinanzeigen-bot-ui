import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { loadUsers, ensureJwtSecret, getUserWorkspace } from '@/lib/yaml/users';
import { decodeJwt } from '@/lib/auth/jwt';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';
import { validatePathWithin } from '@/lib/security/validation';
import { ALLOWED_IMAGE_EXTENSIONS } from '@/lib/images/upload';
import { toNFC } from '@/lib/images/normalize';
import { resolveExistingPath } from '@/lib/fs/resolve-path';
import { readFile, stat } from 'fs';
import { promisify } from 'util';
import path from 'path';

const readFileAsync = promisify(readFile);
const statAsync = promisify(stat);

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const file = searchParams.get('file');
    const name = searchParams.get('name');

    if (!file || !name) {
      return NextResponse.json({ detail: 'file and name parameters required' }, { status: 400 });
    }

    // Authenticate via httpOnly access cookie (sent automatically by browser with <img> requests)
    // or Authorization header (for direct API clients)
    const jwtToken =
      request.cookies.get(ACCESS_COOKIE)?.value ??
      request.headers.get('authorization')?.slice(7) ??
      null;

    if (!jwtToken) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    // loadUsers() has mtime-based in-memory cache — no disk I/O on cache hit
    const data = loadUsers();
    if (!data) {
      return NextResponse.json({ detail: 'Setup required' }, { status: 401 });
    }

    const secret = ensureJwtSecret(data);
    const payload = await decodeJwt(jwtToken, secret);
    const userId = payload.sub as string;
    const ws = getUserWorkspace(userId);

    // Derive adDir from the relative file path — no YAML parse needed
    const normalizedFile = toNFC(file);
    const nfcName = toNFC(name);
    const adDir = path.join(ws, path.dirname(normalizedFile));
    validatePathWithin(adDir, ws);

    const imagePath = path.join(adDir, nfcName);
    validatePathWithin(imagePath, adDir);

    const ext = path.extname(nfcName).toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      return NextResponse.json({ detail: `Image ${nfcName} not found` }, { status: 404 });
    }

    const resolvedPath = resolveExistingPath(imagePath);
    if (!resolvedPath) {
      return NextResponse.json({ detail: `Image ${nfcName} not found` }, { status: 404 });
    }

    // ETag from mtime+size — enables 304 on repeat visits
    const fileStat = await statAsync(resolvedPath);
    const etag = `"${fileStat.mtimeMs.toString(36)}-${fileStat.size.toString(36)}"`;

    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304 });
    }

    const content = await readFileAsync(resolvedPath);
    const contentType = MIME_MAP[ext] ?? 'application/octet-stream';

    return new Response(content, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
        'ETag': etag,
        'Last-Modified': new Date(fileStat.mtimeMs).toUTCString(),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
