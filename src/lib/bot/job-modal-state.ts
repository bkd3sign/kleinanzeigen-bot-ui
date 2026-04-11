// Lightweight reactive flag: tracks whether a JobOutputModal is currently open.
// Used by MfaOverlay to suppress the duplicate MFA modal.

let open = false;
const listeners = new Set<() => void>();

function emit() { listeners.forEach((fn) => fn()); }

export const jobModalState = {
  get isOpen() { return open; },
  setOpen(value: boolean) {
    if (open === value) return;
    open = value;
    emit();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  getSnapshot() { return open; },
};
