import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';

interface KleinanzeigeLocation {
  id: number;
  name: string;
  zipCode: string;
}

// In-memory cache: PLZ → location list (populated at runtime)
const locationCache = new Map<string, KleinanzeigeLocation[]>();

// No auth required — this is a public PLZ lookup proxy
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const zipCode = searchParams.get('zipCode')?.trim();
    if (!zipCode || !/^\d{5}$/.test(zipCode)) {
      return NextResponse.json({ detail: 'Valid 5-digit zipCode required' }, { status: 400 });
    }

    if (locationCache.has(zipCode)) {
      return NextResponse.json({ locations: locationCache.get(zipCode) });
    }

    let locations: KleinanzeigeLocation[] = [];
    try {
      const res = await fetch(
        `https://www.kleinanzeigen.de/p-orte-der-plz.json?zipCode=${zipCode}`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; kleinanzeigen-bot-ui/1.0)' },
          signal: AbortSignal.timeout(6000),
        },
      );

      if (res.ok) {
        const raw = await res.json() as Array<{ id: number; name: string; lat: number; lng: number; zipCode: string }>;
        locations = raw.map(({ id, name, zipCode: zc }) => ({ id, name, zipCode: zc }));
        locationCache.set(zipCode, locations);
      }
    } catch {
      // External API unreachable — fall back to free-text input in the UI
    }

    return NextResponse.json({ locations });
  } catch (error) {
    return handleApiError(error);
  }
}
