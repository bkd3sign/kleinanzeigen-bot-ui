import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import fs from 'fs';
import path from 'path';

// In-memory cache for categories
let categoriesCache: unknown[] | null = null;

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    if (categoriesCache !== null) {
      return NextResponse.json({ categories: categoriesCache });
    }

    const categoriesFile = path.join(process.cwd(), 'public', 'data', 'categories.json');
    if (!fs.existsSync(categoriesFile)) {
      return NextResponse.json({ categories: [] });
    }

    const content = fs.readFileSync(categoriesFile, 'utf-8');
    categoriesCache = JSON.parse(content);

    return NextResponse.json({ categories: categoriesCache });
  } catch (error) {
    return handleApiError(error);
  }
}
