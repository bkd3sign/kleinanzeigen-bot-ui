import { describe, it, expect, beforeEach } from 'vitest';
import { allocateVncSlot, releaseVncSlot, getVncSlot } from '../ports';

// Reset shared state between tests
beforeEach(() => {
  // Clear the global maps so tests are isolated
  const g = globalThis as unknown as {
    __vncSlots?: Map<string, number>;
    __vncFree?: number[];
    __vncCounter?: number;
  };
  if (g.__vncSlots) g.__vncSlots.clear();
  if (g.__vncFree) g.__vncFree.length = 0;
  if (g.__vncCounter !== undefined) g.__vncCounter = 90;
});

describe('vnc ports', () => {
  it('stable per workspace, unique across workspaces', () => {
    const a = allocateVncSlot('/ws/a');
    const a2 = allocateVncSlot('/ws/a');
    const b = allocateVncSlot('/ws/b');
    expect(a).toEqual(a2);
    expect(a.display).not.toBe(b.display);
    expect(a.rfbPort).toBe(5900 + a.display);
  });

  it('release frees the slot', () => {
    allocateVncSlot('/ws/c');
    releaseVncSlot('/ws/c');
    expect(getVncSlot('/ws/c')).toBeUndefined();
  });

  it('display starts at 90', () => {
    const slot = allocateVncSlot('/ws/first');
    expect(slot.display).toBe(90);
    expect(slot.rfbPort).toBe(5990);
  });

  it('recycled slots are reused', () => {
    const a = allocateVncSlot('/ws/d');
    const displayD = a.display;
    releaseVncSlot('/ws/d');
    const e = allocateVncSlot('/ws/e');
    expect(e.display).toBe(displayD);
  });

  it('getVncSlot returns slot for allocated workspace', () => {
    allocateVncSlot('/ws/f');
    const slot = getVncSlot('/ws/f');
    expect(slot).toBeDefined();
    expect(slot!.rfbPort).toBe(5900 + slot!.display);
  });
});
