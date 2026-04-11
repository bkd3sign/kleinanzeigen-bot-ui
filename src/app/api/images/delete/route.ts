import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { findAdByFile, writeAd } from '@/lib/yaml/ads';
import { validatePathWithin } from '@/lib/security/validation';
import path from 'path';
import fs from 'fs';

export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const file = searchParams.get('file');
    const name = searchParams.get('name');

    if (!file || !name) {
      return NextResponse.json({ detail: 'file and name parameters required' }, { status: 400 });
    }

    const result = findAdByFile(file, user.workspace);
    if (!result) {
      return NextResponse.json({ detail: `Ad file ${file} not found` }, { status: 404 });
    }

    const adDir = path.dirname(result.path);
    const imagePath = path.join(adDir, name);

    // Security: prevent directory traversal
    validatePathWithin(imagePath, adDir);

    // Delete file if it exists
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    // Remove from images list
    const ad = result.ad;
    const images = ((ad.images as string[]) ?? []).filter((img) => img !== name);
    ad.images = images;
    writeAd(result.path, ad);

    return NextResponse.json({ deleted: name, images });
  } catch (error) {
    return handleApiError(error);
  }
}
