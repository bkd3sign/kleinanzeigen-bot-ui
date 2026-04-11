import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { getConversation, sendMessage } from '@/lib/messaging/gateway';
import { getAiSentMessages } from '@/lib/messaging/responder';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { conversationId } = await params;
    const data = await getConversation(user.workspace, conversationId);
    const aiSent = getAiSentMessages(user.workspace, conversationId);
    return NextResponse.json({ ...data, aiSentTexts: aiSent.map(m => m.text) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const { conversationId } = await params;
    const body = await request.json();
    const text = body.message as string;

    if (!text?.trim()) {
      return NextResponse.json({ detail: 'Nachricht darf nicht leer sein' }, { status: 400 });
    }

    const result = await sendMessage(user.workspace, conversationId, text.trim());
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
