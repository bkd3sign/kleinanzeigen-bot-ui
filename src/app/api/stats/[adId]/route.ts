import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { loadStats } from '@/lib/stats/stats-fetcher';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ adId: string }> },
) {
  try {
    const user = await getCurrentUser(request);

    const { adId } = await params;
    const stats = loadStats(user.workspace);
    const record = stats.ads[adId];

    if (!record) {
      return NextResponse.json({ detail: 'No stats for this ad' }, { status: 404 });
    }

    return NextResponse.json({ current: record.current, history: record.history });
  } catch (error) {
    return handleApiError(error);
  }
}
