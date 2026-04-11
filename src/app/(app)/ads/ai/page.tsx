'use client';

import { useEffect } from 'react';
import { AiGenerator } from '@/components/ads/AiGenerator/AiGenerator';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import { EmptyState, Spinner } from '@/components/ui';

export default function AiGeneratorPage() {
  const { isAiAvailable, isLoading } = useAiAvailable();

  // Set data attribute on mainWrapper to enable full-height layout (only when AI is available)
  useEffect(() => {
    if (!isAiAvailable) return;
    const wrapper = document.querySelector('[class*="mainWrapper"]');
    if (wrapper) {
      wrapper.setAttribute('data-ai-page', 'true');
      return () => wrapper.removeAttribute('data-ai-page');
    }
  }, [isAiAvailable]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAiAvailable) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
        <EmptyState
          icon={
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          }
          title="KI-Funktion nicht verfügbar"
          message="Trage einen OpenRouter API-Key in der config.yaml unter ai.api_key ein, um die KI-Anzeigenerstellung zu nutzen. Kostenlose Modelle verfügbar auf openrouter.ai."
        />
      </div>
    );
  }

  return <AiGenerator />;
}
