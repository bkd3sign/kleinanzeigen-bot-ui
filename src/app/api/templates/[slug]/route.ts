import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { templateUpdateSchema } from '@/validation/schemas';
import { getCurrentUser } from '@/lib/auth/middleware';
import { readAd, writeAd } from '@/lib/yaml/ads';
import { getTemplatesDir } from '@/lib/yaml/templates';
import path from 'path';
import fs from 'fs';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { slug } = await context.params;
    const templatesDir = getTemplatesDir(user.workspace);
    const filePath = path.join(templatesDir, `tpl_${slug}.yaml`);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ detail: `Template '${slug}' not found` }, { status: 404 });
    }

    const data = readAd(filePath);
    const adData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (!k.startsWith('_')) adData[k] = v;
    }

    return NextResponse.json({
      slug,
      name: data._template_name ?? slug,
      description: data._template_description ?? '',
      locked_fields: data._locked_fields ?? [],
      source_ad_file: data._source_ad_file ?? null,
      ad_data: adData,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { slug } = await context.params;
    const templatesDir = getTemplatesDir(user.workspace);
    const filePath = path.join(templatesDir, `tpl_${slug}.yaml`);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ detail: `Template '${slug}' not found` }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = templateUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { detail: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 },
      );
    }

    const updates = parsed.data;
    const data = readAd(filePath);

    if (updates.name !== undefined) {
      data._template_name = updates.name;
    }
    if (updates.description !== undefined) {
      data._template_description = updates.description;
    }
    if (updates.locked_fields !== undefined) {
      data._locked_fields = updates.locked_fields;
    }
    if (updates.ad_data !== undefined) {
      // Remove old non-meta keys, then merge new ad_data
      for (const k of Object.keys(data)) {
        if (!k.startsWith('_')) delete data[k];
      }
      Object.assign(data, updates.ad_data);
    }

    writeAd(filePath, data);

    return NextResponse.json({ message: 'Template updated', slug });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { slug } = await context.params;
    const templatesDir = getTemplatesDir(user.workspace);
    const filePath = path.join(templatesDir, `tpl_${slug}.yaml`);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ detail: `Template '${slug}' not found` }, { status: 404 });
    }

    fs.unlinkSync(filePath);

    return NextResponse.json({ message: 'Template deleted', slug });
  } catch (error) {
    return handleApiError(error);
  }
}
