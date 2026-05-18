import fs from 'fs';
import path from 'path';

const KA_MANAGE_URL = 'https://www.kleinanzeigen.de/m-meine-anzeigen-verwalten.json';
export const SESSION_FILE = '.temp/login-session.json';

export interface KaManageAd {
  id: number;
  title: string;
  price: string;
  category: string;
  viewCount: number;
  watchCount: number;
  replies: number;
  imageCount: number;
  state: string;
  activationDate?: string;
  endDate?: string;
  adImage?: { url: string };
  seoUrl?: string;
  adPriceType?: string;
  l1CategoryName?: string;
  l2CategoryName?: string;
  creationDate?: string;
  adLifeTimeInSeconds?: number;
}

interface KaPaging {
  pageNum: number;
  pageSize: number;
  numFound: number;
  last: number;
}

interface KaManageResponse {
  ads?: KaManageAd[];
  paging?: KaPaging;
}

export function loadSessionCookies(workspace: string): string | null {
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(workspace, SESSION_FILE), 'utf-8'),
    ) as { cookies: string };
    return data.cookies || null;
  } catch {
    return null;
  }
}

async function fetchPage(cookies: string, page: number): Promise<KaManageResponse> {
  const res = await fetch(`${KA_MANAGE_URL}?sort=DEFAULT&pageNum=${page}`, {
    headers: {
      Cookie: cookies,
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) return {};
  return res.json() as Promise<KaManageResponse>;
}

export async function fetchKaAds(workspace: string): Promise<KaManageAd[]> {
  const cookies = loadSessionCookies(workspace);
  if (!cookies) return [];

  try {
    const first = await fetchPage(cookies, 1);
    const firstAds = first.ads ?? [];
    if (firstAds.length === 0) return [];

    const totalPages = first.paging?.last ?? 1;
    if (totalPages === 1) return firstAds;

    const remaining = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) => fetchPage(cookies, i + 2)),
    );

    return [
      ...firstAds,
      ...remaining.flatMap(r => r.ads ?? []),
    ];
  } catch {
    return [];
  }
}
