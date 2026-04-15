import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { submitMessagingMfa, stopSession, ensureSession } from '@/lib/messaging/gateway';
import { isQueueBusy } from '@/lib/bot/queue';
import { z } from 'zod';

const submitSchema = z.object({
  code: z.string().regex(/^\d{4,8}$/, 'Code muss 4–8 Ziffern sein'),
});

const prepareSchema = z.object({
  action: z.literal('prepare'),
});

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();

    // Prepare: restart login to trigger a fresh MFA code
    if (prepareSchema.safeParse(body).success) {
      if (isQueueBusy()) {
        return NextResponse.json({ detail: 'Bot läuft — bitte warten.' }, { status: 409 });
      }
      stopSession(user.workspace);
      ensureSession(user.workspace).catch(() => {});
      return NextResponse.json({ message: 'Login neu gestartet — neuer Code wird gesendet.' });
    }

    // Submit: send MFA code to browser
    const { code } = submitSchema.parse(body);
    const result = await submitMessagingMfa(user.workspace, code);

    if (!result.success) {
      return NextResponse.json({ detail: result.error }, { status: 422 });
    }

    return NextResponse.json({ message: 'MFA erfolgreich' });
  } catch (error) {
    return handleApiError(error);
  }
}
