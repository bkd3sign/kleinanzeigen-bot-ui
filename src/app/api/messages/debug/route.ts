import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { loadUsers, ensureJwtSecret, getUserWorkspace } from '@/lib/yaml/users';
import { decodeJwt } from '@/lib/auth/jwt';
import { getConversation } from '@/lib/messaging/gateway';
import { buildSystemPrompt, buildChatMessages } from '@/lib/messaging/prompts';

/**
 * Debug endpoint: shows the LLM system prompt for a conversation.
 * GET /api/messages/debug?id=conversationId&token=jwt
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ detail: 'Not available' }, { status: 404 });
  }

  try {
    const { searchParams } = new URL(request.url);
    let token = searchParams.get('token');
    if (!token) {
      const auth = request.headers.get('authorization');
      if (auth?.startsWith('Bearer ')) token = auth.slice(7);
    }
    if (!token) {
      return NextResponse.json({ detail: 'token parameter required' }, { status: 401 });
    }

    const data = await loadUsers();
    if (!data) return NextResponse.json({ detail: 'Setup required' }, { status: 401 });
    const secret = await ensureJwtSecret(data);
    const payload = await decodeJwt(token, secret);
    const workspace = getUserWorkspace(payload.sub as string);

    const convId = new URL(request.url).searchParams.get('id');
    if (!convId) {
      return NextResponse.json({ detail: 'id parameter required' }, { status: 400 });
    }

    const conv = await getConversation(workspace, convId);
    const systemPrompt = buildSystemPrompt(workspace, conv);
    const messages = buildChatMessages(conv, systemPrompt);

    return NextResponse.json({
      conversationId: convId,
      adId: conv.adId,
      adTitle: conv.adTitle,
      systemPrompt,
      messageCount: messages.length,
      messages: messages.map(m => ({ role: m.role, content: m.content.slice(0, 200) + (m.content.length > 200 ? '...' : '') })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
