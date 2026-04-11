import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication required' }, { status: 401 });
    }

    const botDir = process.env.BOT_DIR ?? process.cwd();
    const botCmd = process.env.BOT_CMD ?? path.join(botDir, 'bot', 'kleinanzeigen-bot');

    try {
      const { stdout } = await execFileAsync(botCmd, ['version'], {
        cwd: botDir,
        timeout: 10000,
      });
      return NextResponse.json({ output: stdout.trim() });
    } catch (error) {
      return NextResponse.json({ output: 'Nicht verfügbar' });
    }
  } catch (error) {
    return handleApiError(error);
  }
}
