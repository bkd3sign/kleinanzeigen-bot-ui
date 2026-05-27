import { NextRequest, NextResponse } from 'next/server';
import { loadUsers, ensureJwtSecret } from '@/lib/yaml/users';
import { decodeJwt } from '@/lib/auth/jwt';
import { ACCESS_COOKIE } from '@/lib/auth/cookies';

/**
 * Proxy for Kleinanzeigen ad images.
 * Avoids CORS/mixed-content issues by serving images through our domain.
 * Auth via httpOnly kb_token cookie (sent automatically by browser) or Authorization header.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');

    // Strict hostname check to prevent open proxy abuse
    let validHost = false;
    try {
      const hostname = new URL(imageUrl!).hostname;
      validHost = hostname.endsWith('.kleinanzeigen.de') || hostname === 'kleinanzeigen.de';
    } catch { /* invalid URL */ }
    if (!imageUrl || !validHost) {
      return new NextResponse(null, { status: 400 });
    }

    // Authenticate via httpOnly access cookie or Authorization header
    const jwtToken =
      request.cookies.get(ACCESS_COOKIE)?.value ??
      request.headers.get('authorization')?.slice(7) ??
      null;

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
      // Return transparent 1×1 PNG instead of 404 to avoid browser console errors
      // for expired/deleted ad images (common for old conversations)
      const placeholder = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64'
      );
      return new NextResponse(placeholder, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=300',
        },
      });
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
