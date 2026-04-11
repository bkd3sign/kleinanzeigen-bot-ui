import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { templateCreateSchema } from '@/validation/schemas';
import { getCurrentUser } from '@/lib/auth/middleware';
import { readAd, writeAd } from '@/lib/yaml/ads';
import { getTemplatesDir, findTemplateFiles, slugFromName } from '@/lib/yaml/templates';
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
        file: path.relative(user.workspace, filePath),
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

    const filePath = path.join(templatesDir, `tpl_${slug}.yaml`);
    if (fs.existsSync(filePath)) {
      return NextResponse.json(
        { detail: `Template '${slug}' already exists` },
        { status: 409 },
      );
    }

    const data: Record<string, unknown> = {
      _template_name: name,
      _template_description: description,
      _locked_fields: locked_fields,
      ...ad_data,
    };
    writeAd(filePath, data);

    return NextResponse.json({
      message: 'Template created',
      slug,
      file: path.relative(user.workspace, filePath),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
