import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get('title')?.trim();
  if (!title) return NextResponse.json(null);

  try {
    const res = await fetch(
      `https://www.kleinanzeigen.de/p-category-suggestion.json?title=${encodeURIComponent(title)}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } },
    );
    if (!res.ok) return NextResponse.json(null);

    const suggestion = await res.json() as Record<string, unknown>;

    const base = `${suggestion.parent_id}/${suggestion.category_id}`;
    const l3Value = suggestion.l3_value as string | undefined;
    const id = l3Value ? `${base}/${l3Value}` : base as string;

    // Extract all lN_id / lN_value pairs as attributes (l1, l2, l3, …)
    const attrs: Record<string, string> = {};
    for (let n = 1; n <= 9; n++) {
      const key = suggestion[`l${n}_id`] as string | undefined;
      const val = suggestion[`l${n}_value`] as string | undefined;
      if (key && val) attrs[key] = val;
    }

    return NextResponse.json({ id, attrs });
  } catch {
    return NextResponse.json(null);
  }
}
