/**
 * VNC slot allocation — per-workspace X display and RFB port assignment.
 *
 * Displays start at :90 (rfbPort 5990) to avoid conflicts with system displays
 * and the messaging CDP port range (9223+). State is persisted on globalThis so
 * it survives Next.js HMR restarts, mirroring the pattern used by jobs.ts.
 */

export const DISPLAY_START = 90;

interface VncGlobal {
  /** workspace → display number */
  __vncSlots?: Map<string, number>;
  /** display numbers that have been released and can be recycled */
  __vncFree?: number[];
  /** next display to hand out when the free list is empty */
  __vncCounter?: number;
}

const g = globalThis as unknown as VncGlobal;

if (!g.__vncSlots) g.__vncSlots = new Map<string, number>();
if (!g.__vncFree) g.__vncFree = [];
if (g.__vncCounter === undefined) g.__vncCounter = DISPLAY_START;

const slots: Map<string, number> = g.__vncSlots;
const free: number[] = g.__vncFree;

/** Hard cap on concurrent VNC sessions — defense-in-depth against host resource
 *  exhaustion (each session is one Xvnc + one Chromium). A single user cannot exceed
 *  this on their own (slots are idempotent per workspace); it bounds the total fleet. */
export const MAX_VNC_SESSIONS = 25;

/** Number of workspaces currently holding a VNC slot. */
export function vncSessionCount(): number {
  return slots.size;
}

/** Allocate a VNC display + RFB port for a workspace. Idempotent. */
export function allocateVncSlot(workspace: string): { display: number; rfbPort: number } {
  const existing = slots.get(workspace);
  if (existing !== undefined) {
    return { display: existing, rfbPort: 5900 + existing };
  }

  // Recycle a freed slot if available, otherwise advance the counter
  const display = free.length > 0 ? (free.shift() as number) : (g.__vncCounter as number)++;

  slots.set(workspace, display);
  return { display, rfbPort: 5900 + display };
}

/** Release the slot held by a workspace so it can be reused. */
export function releaseVncSlot(workspace: string): void {
  const display = slots.get(workspace);
  if (display === undefined) return;
  slots.delete(workspace);
  free.push(display);
}

/** Return the current slot for a workspace, or undefined if not allocated. */
export function getVncSlot(workspace: string): { display: number; rfbPort: number } | undefined {
  const display = slots.get(workspace);
  if (display === undefined) return undefined;
  return { display, rfbPort: 5900 + display };
}
