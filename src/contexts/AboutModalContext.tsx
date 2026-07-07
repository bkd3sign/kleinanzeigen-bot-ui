'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { AboutModal } from '@/components/layout/AboutModal';

interface AboutModalContextValue {
  openAbout: () => void;
}

const AboutModalContext = createContext<AboutModalContextValue | null>(null);

// Owns the single AboutModal instance so any descendant (profile menu,
// update pill) can open it without mounting its own copy.
export function AboutModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openAbout = useCallback(() => setOpen(true), []);
  const closeAbout = useCallback(() => setOpen(false), []);

  return (
    <AboutModalContext.Provider value={{ openAbout }}>
      {children}
      <AboutModal open={open} onClose={closeAbout} />
    </AboutModalContext.Provider>
  );
}

export function useAboutModal(): AboutModalContextValue {
  const ctx = useContext(AboutModalContext);
  if (!ctx) {
    throw new Error('useAboutModal must be used within AboutModalProvider');
  }
  return ctx;
}
