import { NextRequest, NextResponse } from 'next/server';
import { loadUsers, ensureJwtSecret } from '@/lib/yaml/users';
import { decodeJwt } from '@/lib/auth/jwt';

/**
 * Proxy for Kleinanzeigen ad images.
 * Avoids CORS/mixed-content issues by serving images through our domain.
 * Auth via ?token= query param (same pattern as /api/images/file).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');
    let jwtToken = searchParams.get('token');

    // Strict hostname check to prevent open proxy abuse
    let validHost = false;
    try {
      const hostname = new URL(imageUrl!).hostname;
      validHost = hostname.endsWith('.kleinanzeigen.de') || hostname === 'kleinanzeigen.de';
    } catch { /* invalid URL */ }
    if (!imageUrl || !validHost) {
      return new NextResponse(null, { status: 400 });
    }

    // Auth: token from query or Authorization header
    if (!jwtToken) {
      const auth = request.headers.get('authorization');
      if (auth?.startsWith('Bearer ')) jwtToken = auth.slice(7);
    }
    if (!jwtToken) {
      return new NextResponse(null, { status: 401 });
    }

    const data = await loadUsers();
    if (!data) return new NextResponse(null, { status: 401 });
    const secret = await ensureJwtSecret(data);
    await decodeJwt(jwtToken, secret);

    const response = await fetch(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!response.ok) {
      return new NextResponse(null, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
