import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { findAdByFile } from '@/lib/yaml/ads';
import { resolveImageFiles } from '@/lib/images/resolve';
import path from 'path';

export async function GET(request: NextRequest) {
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

    const result = await findAdByFile(file, user.workspace);
    if (!result) {
      return NextResponse.json({ detail: `Ad file ${file} not found` }, { status: 404 });
    }

    const { path: filePath, ad } = result;
    const adDir = path.dirname(filePath);
    const patterns = (ad.images as string[]) ?? [];
    const resolved = resolveImageFiles(adDir, patterns);

    return NextResponse.json({
      images: resolved,
      total: resolved.length,
      patterns,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
