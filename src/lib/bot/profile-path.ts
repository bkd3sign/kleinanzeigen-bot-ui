import path from 'path';

/** Shared per-workspace login profile (bot headless + VNC login both use it). */
export function loginProfilePath(workspace: string): string {
  return path.join(workspace, '.temp', 'browser-profile');
}
