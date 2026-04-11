import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { findAdByFile, writeAd } from '@/lib/yaml/ads';

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const file = searchParams.get('file');
    if (!file) {
      return NextResponse.json({ detail: 'file parameter required' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.order)) {
      return NextResponse.json({ detail: 'order array required' }, { status: 400 });
    }

    const result = findAdByFile(file, user.workspace);
    if (!result) {
      return NextResponse.json({ detail: `Ad file ${file} not found` }, { status: 404 });
    }

    const ad = result.ad;
    ad.images = body.order as string[];
    writeAd(result.path, ad);

    return NextResponse.json({ images: body.order });
  } catch (error) {
    return handleApiError(error);
  }
}
