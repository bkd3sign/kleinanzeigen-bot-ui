import { NextRequest } from 'next/server';
import { loadUsers, ensureJwtSecret } from '@/lib/yaml/users';
import { decodeJwt } from '@/lib/auth/jwt';
import { existsSync, statSync, readdirSync, readFileSync, watch } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // Authenticate via JWT
  const { searchParams } = new URL(request.url);
  let jwtToken = searchParams.get('token');
  if (!jwtToken) {
    const auth = request.headers.get('authorization');
    if (auth?.startsWith('Bearer ')) jwtToken = auth.slice(7);
  }
  if (!jwtToken) {
    return new Response(JSON.stringify({ detail: 'Authentication required' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = await loadUsers();
  if (!data) {
    return new Response(JSON.stringify({ detail: 'Setup required' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const secret = await ensureJwtSecret(data);
  try {
    await decodeJwt(jwtToken, secret);
  } catch (error) {
    return new Response(JSON.stringify({ detail: 'Invalid token' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const botDir = process.env.BOT_DIR ?? process.cwd();
  const encoder = new TextEncoder();

  // Find all log files (can change over time as bots run)
  function findLogFiles(): Array<{ label: string; path: string }> {
    const files: Array<{ label: string; path: string }> = [];
    const usersDir = path.join(botDir, 'users');
    if (existsSync(usersDir)) {
      for (const entry of readdirSync(usersDir)) {
        const userDir = path.join(usersDir, entry);
        try {
          if (!statSync(userDir).isDirectory()) continue;
        } catch (error) { continue; }
        const logPath = path.join(userDir, 'kleinanzeigen-bot.log');
        if (existsSync(logPath)) {
          files.push({ label: entry, path: logPath });
        }
      }
    }
    const globalLog = path.join(botDir, 'kleinanzeigen-bot.log');
    if (existsSync(globalLog)) {
      files.push({ label: 'system', path: globalLog });
    }
    return files;
  }

  const stream = new ReadableStream({
    start(controller) {
      const fileSizes: Record<string, number> = {};
      const watchers: Array<ReturnType<typeof watch>> = [];
      let watchedPaths = new Set<string>();

      function watchFile(logFile: { label: string; path: string }) {
        if (watchedPaths.has(logFile.path)) return;
        watchedPaths.add(logFile.path);

        try {
          fileSizes[logFile.path] = statSync(logFile.path).size;

          const watcher = watch(logFile.path, () => {
            try {
              const newStat = statSync(logFile.path);
              const oldSize = fileSizes[logFile.path] ?? 0;
              if (newStat.size > oldSize) {
                const content = readFileSync(logFile.path, 'utf-8');
                const newContent = content.slice(oldSize);
                const lines = newContent.split('\n').filter(Boolean);
                const prefix = `[${logFile.label}] `;
                for (const line of lines) {
                  controller.enqueue(encoder.encode(`data: ${prefix}${line}\n\n`));
                }
                fileSizes[logFile.path] = newStat.size;
              }
            } catch (error) {
              // File may have been rotated
            }
          });
          watchers.push(watcher);
        } catch (error) {
          watchedPaths.delete(logFile.path);
        }
      }

      // Watch existing log files
      for (const lf of findLogFiles()) {
        watchFile(lf);
      }

      // Periodically check for new log files + send keepalive
      const interval = setInterval(() => {
        for (const lf of findLogFiles()) {
          watchFile(lf);
        }
        controller.enqueue(encoder.encode(': keepalive\n\n'));
      }, 5000);

      // Cleanup
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        for (const w of watchers) w.close();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
