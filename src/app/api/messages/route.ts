import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { listConversations } from '@/lib/messaging/gateway';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const params = new URL(request.url).searchParams;
    const page = parseInt(params.get('page') ?? '0', 10);
    const size = parseInt(params.get('size') ?? '25', 10);

    const data = await listConversations(user.workspace, page, size);
    return NextResponse.json(data);
  } catch (error) {
    return handleApiError(error);
  }
}
