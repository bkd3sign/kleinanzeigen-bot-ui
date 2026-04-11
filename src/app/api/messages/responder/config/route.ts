import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { startResponder, stopResponder } from '@/lib/messaging/responder';
import { stopSession } from '@/lib/messaging/gateway';
import { loadMessagingRules } from '@/lib/messaging/prompts';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const CONFIG_FILE = '.messaging-rules.yaml';

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

    const config = {
      ...existing,
      mode: body.mode ?? existing.mode ?? 'off',
      personality: body.personality ?? existing.personality ?? '',
      availability: body.availability ?? existing.availability ?? [],
      rules: body.rules ?? existing.rules ?? '',
      escalate_keywords: body.escalate_keywords ?? existing.escalate_keywords ?? '',
      min_response_delay: body.min_response_delay ?? existing.min_response_delay ?? 30,
    };

    writeConfig(user.workspace, config);

    // Auto-start or stop responder based on mode
    const mode = config.mode as string;
    if (mode === 'auto' || mode === 'review') {
      startResponder(user.workspace, mode as 'auto' | 'review');
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
