import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import fs from 'fs';
import path from 'path';
import type { StatsFile } from '@/types/stats';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);

    const filePath = path.join(user.workspace, '.ad-stats.json');
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ last_updated: null, ads: {} });
    }

    const stats = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StatsFile;

    // Strip history — only return current values
    const current: Record<string, typeof stats.ads[string]['current']> = {};
    for (const [id, record] of Object.entries(stats.ads)) {
      current[id] = record.current;
    }

    return NextResponse.json({ last_updated: stats.last_updated, ads: current });
  } catch (error) {
    return handleApiError(error);
  }
}
