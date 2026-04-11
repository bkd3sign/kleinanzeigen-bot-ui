import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { findAdByFile, writeAd } from '@/lib/yaml/ads';
import { isValidImage, ALLOWED_IMAGE_EXTENSIONS, MAX_UPLOAD_SIZE } from '@/lib/images/upload';
import path from 'path';
import fs from 'fs';

export async function POST(request: NextRequest) {
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

    const result = findAdByFile(file, user.workspace);
    if (!result) {
      return NextResponse.json({ detail: `Ad file ${file} not found` }, { status: 404 });
    }

    const adDir = path.dirname(result.path);
    const ad = result.ad;

    const formData = await request.formData();
    const files = formData.getAll('files');
    if (!files.length) {
      return NextResponse.json({ detail: 'No files provided' }, { status: 400 });
    }

    const uploaded: string[] = [];

    for (const upload of files) {
      if (!(upload instanceof File)) continue;

      const ext = path.extname(upload.name).toLowerCase();
      if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) continue;

      // Sanitize filename: keep only safe characters
      const safeName = upload.name.replace(/[^a-zA-Z0-9._-]/g, '');
      if (!safeName) continue;

      const content = Buffer.from(await upload.arrayBuffer());

      // Enforce size limit
      if (content.length > MAX_UPLOAD_SIZE) {
        return NextResponse.json(
          { detail: `File '${upload.name}' exceeds ${MAX_UPLOAD_SIZE / (1024 * 1024)} MB limit` },
          { status: 413 },
        );
      }

      // Validate image magic bytes
      if (!isValidImage(content)) {
        return NextResponse.json(
          { detail: `File '${upload.name}' is not a valid image` },
          { status: 400 },
        );
      }

      const dest = path.join(adDir, safeName);
      fs.writeFileSync(dest, content);
      uploaded.push(safeName);
    }

    // Add filenames to ad images list if not already present
    const images = (ad.images as string[]) ?? [];
    for (const name of uploaded) {
      if (!images.includes(name)) {
        images.push(name);
      }
    }
    ad.images = images;
    writeAd(result.path, ad);

    return NextResponse.json({ uploaded, images });
  } catch (error) {
    return handleApiError(error);
  }
}
