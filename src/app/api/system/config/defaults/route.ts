import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { readMergedConfig } from '@/lib/yaml/config';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const config = readMergedConfig(user.workspace);
    const defaults = config.ad_defaults ?? {};

    return NextResponse.json({ ad_defaults: defaults });
  } catch (error) {
    return handleApiError(error);
  }
}
