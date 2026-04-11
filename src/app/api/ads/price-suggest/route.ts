import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const title = searchParams.get('title')?.trim();
  const categoryId = searchParams.get('categoryId');
  const attrKey = searchParams.get('attrKey');
  const attrValue = searchParams.get('attrValue');

  if (!title || !categoryId) return NextResponse.json(null);

  const params = new URLSearchParams({ title, categoryId });
  if (attrKey && attrValue) params.set('selectedAttributes', `${attrKey}:${attrValue}`);

  try {
    const res = await fetch(
      `https://www.kleinanzeigen.de/p-price-suggestion.json?${params}`,
      { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } },
    );
    if (!res.ok) return NextResponse.json(null);

    const data = await res.json() as { lowerBoundary?: number; upperBoundary?: number };
    if (data.lowerBoundary == null || data.upperBoundary == null) return NextResponse.json(null);

    return NextResponse.json({ market_low: data.lowerBoundary, market_high: data.upperBoundary });
  } catch {
    return NextResponse.json(null);
  }
}
