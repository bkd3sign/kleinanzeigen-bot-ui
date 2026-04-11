import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { checkCompatibility, checkUpstreamCompatibility } from '@/lib/bot/compatibility';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ detail: 'Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode');
    const version = searchParams.get('version') || 'latest';

    if (mode === 'upstream') {
      const result = await checkUpstreamCompatibility(version);
      return NextResponse.json(result);
    }

    const result = checkCompatibility();
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
