import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { getTemplatesDir, findTemplateFile } from '@/lib/yaml/templates';
import { readAd } from '@/lib/yaml/ads';
import { loadCatAttrsData, translateAttrValues } from '@/lib/ads/normalize-attributes';
import path from 'path';
import { toNFC } from '@/lib/images/normalize';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { slug } = await context.params;
    const templatesDir = getTemplatesDir(user.workspace);
    const filePath = findTemplateFile(templatesDir, slug);

    if (!filePath) {
      return NextResponse.json(
        { detail: `Template '${slug}' not found` },
        { status: 404 },
      );
    }

    const data = await readAd(filePath);
    const lockedFields = (data._locked_fields as string[]) ?? [];
    const templateName = (data._template_name as string) ?? slug;

    // Filter out template metadata keys
    const adData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (!k.startsWith('_')) {
        adData[k] = v;
      }
    }

    // For dir-based templates, serve images from the template directory itself.
    // For legacy flat templates, fall back to the stored _source_ad_file.
    const tplDir = path.join(templatesDir, `tpl_${slug}`);
    const isDirBased = filePath === path.join(tplDir, `tpl_${slug}.yaml`);
    const sourceAdFile = isDirBased
      ? toNFC(path.relative(user.workspace, filePath))
      : ((data._source_ad_file as string) ?? null);

    // Translate legacy API values → display text (templates saved before normalization)
    const catData = loadCatAttrsData();
    const templateCategory = adData.category ? String(adData.category) : '';
    if (catData && templateCategory && adData.special_attributes) {
      adData.special_attributes = translateAttrValues(
        adData.special_attributes as Record<string, string>,
        templateCategory,
        catData,
      );
    }

    return NextResponse.json({
      ad_data: adData,
      locked_fields: lockedFields,
      template_name: templateName,
      source_ad_file: sourceAdFile,
      template_slug: slug,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
