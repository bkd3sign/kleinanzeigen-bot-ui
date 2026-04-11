import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { loadUsers, ensureJwtSecret, getUserWorkspace } from '@/lib/yaml/users';
import { decodeJwt } from '@/lib/auth/jwt';
import { findAdByFile } from '@/lib/yaml/ads';
import { validatePathWithin } from '@/lib/security/validation';
import { ALLOWED_IMAGE_EXTENSIONS } from '@/lib/images/upload';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const file = searchParams.get('file');
    const name = searchParams.get('name');
    let jwtToken = searchParams.get('token');

    if (!file || !name) {
      return NextResponse.json({ detail: 'file and name parameters required' }, { status: 400 });
    }

    // Authenticate via query param token or Authorization header
    if (!jwtToken) {
      const auth = request.headers.get('authorization');
      if (auth?.startsWith('Bearer ')) {
        jwtToken = auth.slice(7);
      }
    }
    if (!jwtToken) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const data = await loadUsers();
    if (!data) {
      return NextResponse.json({ detail: 'Setup required' }, { status: 401 });
    }

    const secret = await ensureJwtSecret(data);
    const payload = await decodeJwt(jwtToken, secret);
    const userId = payload.sub as string;
    const ws = getUserWorkspace(userId);

    // Find ad file and resolve image
    const result = await findAdByFile(file, ws);
    if (!result) {
      return NextResponse.json({ detail: `Ad file ${file} not found` }, { status: 404 });
    }

    const { path: filePath } = result;
    const adDir = path.dirname(filePath);
    const imagePath = path.join(adDir, name);

    // Security: prevent directory traversal
    const validPath = validatePathWithin(imagePath, adDir);
    if (!validPath) {
      return NextResponse.json({ detail: 'Access denied' }, { status: 403 });
    }

    const ext = path.extname(name).toLowerCase();
    if (!existsSync(imagePath) || !ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      return NextResponse.json({ detail: `Image ${name} not found` }, { status: 404 });
    }

    const content = readFileSync(imagePath);
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
    };
    const contentType = mimeMap[ext] ?? 'application/octet-stream';

    return new Response(content, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
