import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { startResponder, stopResponder, markOooActivated } from '@/lib/messaging/responder';
import { stopSession } from '@/lib/messaging/gateway';
import { loadMessagingRules } from '@/lib/messaging/prompts';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const CONFIG_FILE = '.messaging-rules.yaml';
// Cap the out-of-office note: it is stored in YAML and sent verbatim to buyers.
const MAX_OOO_MESSAGE_LENGTH = 2000;

function writeConfig(workspace: string, data: Record<string, unknown>): void {
  const filePath = path.join(workspace, CONFIG_FILE);
  fs.writeFileSync(filePath, yaml.dump(data, { flowLevel: -1, sortKeys: false }), 'utf-8');
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const config = loadMessagingRules(user.workspace);
    return NextResponse.json(config);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const existing = loadMessagingRules(user.workspace);

    if (body.out_of_office_message !== undefined && typeof body.out_of_office_message !== 'string') {
      return NextResponse.json(
        { detail: 'Abwesenheits-Nachricht muss ein Text sein' },
        { status: 400 },
      );
    }
    if (typeof body.out_of_office_message === 'string' && body.out_of_office_message.length > MAX_OOO_MESSAGE_LENGTH) {
      return NextResponse.json(
        { detail: `Abwesenheits-Nachricht darf höchstens ${MAX_OOO_MESSAGE_LENGTH} Zeichen lang sein` },
        { status: 400 },
      );
    }

    const config = {
      ...existing,
      mode: body.mode ?? existing.mode ?? 'off',
      personality: body.personality ?? existing.personality ?? '',
      availability: body.availability ?? existing.availability ?? [],
      rules: body.rules ?? existing.rules ?? '',
      escalate_keywords: body.escalate_keywords ?? existing.escalate_keywords ?? '',
      out_of_office_message: body.out_of_office_message ?? existing.out_of_office_message ?? '',
    };

    // Out-of-office without a note would start the responder but send nothing — reject server-side
    // too (not just in the UI), so a direct API call can't enter a silently-dead mode.
    if (config.mode === 'out_of_office' && !String(config.out_of_office_message ?? '').trim()) {
      return NextResponse.json(
        { detail: 'Abwesenheitsmodus benötigt eine Abwesenheits-Nachricht' },
        { status: 400 },
      );
    }

    writeConfig(user.workspace, config);

    // Auto-start or stop responder based on mode
    const mode = config.mode as string;
    if (mode === 'auto' || mode === 'review' || mode === 'out_of_office') {
      // Newly switching into out-of-office starts a fresh period — returning buyers get the note again
      if (mode === 'out_of_office' && existing.mode !== 'out_of_office') {
        markOooActivated(user.workspace);
      }
      startResponder(user.workspace, mode as 'auto' | 'review' | 'out_of_office');
    } else {
      stopResponder(user.workspace);
      // Close browser when KI is off (saves ~100MB RAM per user)
      stopSession(user.workspace);
    }

    return NextResponse.json({ message: 'Gespeichert' });
  } catch (error) {
    return handleApiError(error);
  }
}
