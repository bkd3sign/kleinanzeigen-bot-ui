import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { title: string; categoryId: string; attrs?: Record<string, string> };
    if (!body.title || !body.categoryId) return NextResponse.json(null);

    const payload = {
      title: body.title,
      categoryId: body.categoryId,
      previousCategoryId: body.categoryId,
      attributes: JSON.stringify(body.attrs ?? {}),
    };

    const res = await fetch('https://www.kleinanzeigen.de/p-attribute-suggestion.json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return NextResponse.json(null);

    const data = await res.json() as Record<string, unknown>;
    if (!data || Object.keys(data).length === 0) return NextResponse.json(null);

    // Extract only string-valued attributes (skip meta fields like categoryId)
    const attrs: Record<string, string> = {};
    for (const [key, val] of Object.entries(data)) {
      if (typeof val === 'string' && key !== 'categoryId' && key !== 'previousCategoryId') {
        attrs[key] = val;
      }
    }

    return NextResponse.json(Object.keys(attrs).length > 0 ? attrs : null);
  } catch {
    return NextResponse.json(null);
  }
}
