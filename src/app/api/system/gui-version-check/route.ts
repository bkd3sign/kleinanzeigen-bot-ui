import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { isVersionUpToDate, FALLBACK_VERSION } from '@/lib/update-check/pill-state';

const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? FALLBACK_VERSION;

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ detail: 'Admin access required' }, { status: 403 });
    }

    const response = await fetch(
      'https://api.github.com/repos/bkd3sign/kleinanzeigen-bot-ui/releases/latest',
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'kleinanzeigen-bot-ui',
        },
        next: { revalidate: 300 },
      }
    );

    if (!response.ok) {
      return NextResponse.json({ detail: 'GitHub API nicht erreichbar' }, { status: 502 });
    }

    const data = await response.json() as { tag_name: string; html_url: string };
    const latestVersion = data.tag_name.replace(/^v/, '');

    return NextResponse.json({
      upToDate: isVersionUpToDate(currentVersion, latestVersion),
      currentVersion,
      latestVersion,
      releaseUrl: data.html_url,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
