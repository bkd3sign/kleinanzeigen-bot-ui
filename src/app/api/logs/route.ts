import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, requireAdmin } from '@/lib/auth/middleware';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { jobs } from '@/lib/bot/jobs';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    requireAdmin(user);

    const { searchParams } = new URL(request.url);
    const lines = Math.min(Math.max(parseInt(searchParams.get('lines') ?? '100', 10) || 100, 1), 5000);

    const botDir = process.env.BOT_DIR ?? process.cwd();
    const allLines: string[] = [];

    // Collect logs from all user workspaces
    const usersDir = path.join(botDir, 'users');
    if (existsSync(usersDir)) {
      for (const entry of readdirSync(usersDir)) {
        const userDir = path.join(usersDir, entry);
        if (!statSync(userDir).isDirectory()) continue;
        const logPath = path.join(userDir, 'kleinanzeigen-bot.log');
        if (existsSync(logPath)) {
          const content = readFileSync(logPath, 'utf-8');
          for (const line of content.split('\n')) {
            if (line) allLines.push(`[${entry}] ${line}`);
          }
        }
      }
    }

    // Also include global log
    const globalLog = path.join(botDir, 'kleinanzeigen-bot.log');
    if (existsSync(globalLog)) {
      const content = readFileSync(globalLog, 'utf-8');
      allLines.push(...content.split('\n').filter(Boolean));
    }

    // Include recent job outputs
    const recentJobs = Array.from(jobs.values())
      .sort((a, b) => (a.started_at > b.started_at ? 1 : -1));
    for (const job of recentJobs) {
      if (job.output) {
        const prefix = `[job:${job.command}] `;
        for (const line of job.output.split('\n')) {
          if (line.trim()) allLines.push(`${prefix}${line}`);
        }
      }
    }

    if (allLines.length === 0) {
      return NextResponse.json({ logs: '', message: 'No log files found' });
    }

    return NextResponse.json({
      logs: allLines.slice(-lines).join('\n'),
      total_lines: allLines.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
