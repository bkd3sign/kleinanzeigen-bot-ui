import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { getTemplatesDir } from '@/lib/yaml/templates';
import { readAd } from '@/lib/yaml/ads';
import path from 'path';
import { existsSync } from 'fs';

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
    const filePath = path.join(templatesDir, `tpl_${slug}.yaml`);

    if (!existsSync(filePath)) {
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

    const sourceAdFile = (data._source_ad_file as string) ?? null;

    return NextResponse.json({
      ad_data: adData,
      locked_fields: lockedFields,
      template_name: templateName,
      source_ad_file: sourceAdFile,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
