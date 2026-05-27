import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { templateCreateSchema } from '@/validation/schemas';
import { getCurrentUser } from '@/lib/auth/middleware';
import { readAd, writeAd } from '@/lib/yaml/ads';
import { getTemplatesDir, findTemplateFiles, slugFromName } from '@/lib/yaml/templates';
import { resolveImageFiles } from '@/lib/images/resolve';
import { toNFC } from '@/lib/images/normalize';
import { resolveExistingPath } from '@/lib/fs/resolve-path';
import path from 'path';
import fs from 'fs';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const templates = [];
    for (const filePath of findTemplateFiles(user.workspace)) {
      const data = readAd(filePath);
      const slug = path.basename(filePath, '.yaml').replace(/^tpl_/, '');
      templates.push({
        slug,
        name: data._template_name ?? path.basename(filePath, '.yaml'),
        description: data._template_description ?? '',
        locked_fields: data._locked_fields ?? [],
        category: data.category ?? '',
        file: toNFC(path.relative(user.workspace, filePath)),
      });
    }

    return NextResponse.json({ templates, total: templates.length });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = templateCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const { name, description, locked_fields, ad_data } = parsed.data;
    const slug = slugFromName(name);
    if (!slug) {
      return NextResponse.json({ detail: 'Invalid template name' }, { status: 400 });
    }

    const templatesDir = getTemplatesDir(user.workspace);
    fs.mkdirSync(templatesDir, { recursive: true });

    // Dir-based template: ads/templates/tpl_{slug}/tpl_{slug}.yaml
    const tplDir = path.join(templatesDir, `tpl_${slug}`);
    const filePath = path.join(tplDir, `tpl_${slug}.yaml`);

    // Also check legacy flat path for conflict
    const legacyPath = path.join(templatesDir, `tpl_${slug}.yaml`);
    if (fs.existsSync(filePath) || fs.existsSync(legacyPath)) {
      return NextResponse.json(
        { detail: `Template '${slug}' already exists` },
        { status: 409 },
      );
    }

    // Resolve and copy images from source ad
    const sourceAdFile = ad_data._source_ad_file as string | undefined;
    let resolvedImages: string[] = [];
    let resolvedSourceAdPath: string | null = null;
    if (sourceAdFile && Array.isArray(ad_data.images) && (ad_data.images as string[]).length > 0) {
      resolvedSourceAdPath = resolveExistingPath(path.join(user.workspace, sourceAdFile));
      if (resolvedSourceAdPath) {
        const sourceAdDir = path.dirname(resolvedSourceAdPath);
        resolvedImages = resolveImageFiles(sourceAdDir, ad_data.images as string[]);
      }
    }

    fs.mkdirSync(tplDir, { recursive: true });

    // Copy image files into template directory
    if (resolvedImages.length > 0 && resolvedSourceAdPath) {
      const sourceAdDir = path.dirname(resolvedSourceAdPath);
      for (const imgName of resolvedImages) {
        const src = resolveExistingPath(path.join(sourceAdDir, imgName));
        const dest = path.join(tplDir, imgName);
        try {
          if (src) fs.copyFileSync(src, dest);
        } catch { /* skip unreadable files */ }
      }
    }

    const data: Record<string, unknown> = {
      _template_name: name,
      _template_description: description,
      _locked_fields: locked_fields,
      ...ad_data,
      // Store resolved filenames, not globs
      images: resolvedImages,
    };
    writeAd(filePath, data);

    return NextResponse.json({
      message: 'Template created',
      slug,
      file: toNFC(path.relative(user.workspace, filePath)),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
