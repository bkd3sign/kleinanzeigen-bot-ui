import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { updateOptionsSchema } from '@/validation/schemas';
import { getCurrentUser } from '@/lib/auth/middleware';
import { startJob } from '@/lib/bot/jobs';
import { buildFlags } from '@/lib/bot/flags';
import { validateAdsParam } from '@/lib/security/validation';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = updateOptionsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const { ads, verbose } = parsed.data;
    const validatedAds = validateAdsParam(ads, new Set(['all', 'changed']));

    const flags = buildFlags({ ads: validatedAds, verbose });
    const job = startJob(`update ${flags}`.trim(), user.workspace, user.id);
    return NextResponse.json(job);
  } catch (error) {
    return handleApiError(error);
  }
}
