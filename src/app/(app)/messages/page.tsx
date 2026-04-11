'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useMessagingStatus, useConversations, useResponderStatus } from '@/hooks/useMessages';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import { Spinner, EmptyState, Badge } from '@/components/ui';
import { ConversationList } from '@/components/messages/ConversationList';
import { ChatView } from '@/components/messages/ChatView';
import styles from '@/components/messages/Messages.module.scss';

const STATUS_MESSAGES: Record<string, string> = {
  starting: 'Browser wird gestartet...',
  logging_in: 'Anmeldung bei Kleinanzeigen...',
  not_started: 'Messaging wird initialisiert...',
};

function StatusView({ status, error }: { status: string; error?: string }) {
  const isLoading = status === 'starting' || status === 'logging_in' || status === 'not_started';

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-10)', gap: 'var(--space-4)' }}>
        <Spinner size="lg" />
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
          {STATUS_MESSAGES[status] || 'Verbindung wird hergestellt...'}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
      <EmptyState
        icon={
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
        title="Messaging nicht verfügbar"
        message={error || 'Bitte einen Bot-Befehl ausführen um sich einzuloggen.'}
      />
    </div>
  );
}

function AiBadge() {
  const { data: responder } = useResponderStatus();
  const { isAiAvailable } = useAiAvailable();
  if (!isAiAvailable || !responder || responder.mode === 'off') return null;

  const label = responder.mode === 'auto' ? 'KI Auto' : 'KI Review';
  const variant: 'success' | 'info' = responder.mode === 'auto' ? 'success' : 'info';
  const pending = responder.pendingCount > 0 ? ` (${responder.pendingCount})` : '';

  return (
    <Badge variant={variant}>
      {label}{pending}
    </Badge>
  );
}

function AiUpsellBanner() {
  const { isAiAvailable } = useAiAvailable();
  const [dismissed, setDismissed] = useState(false);

  if (isAiAvailable || dismissed) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)',
      background: 'var(--accent-subtle)', border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-lg)', margin: 'var(--space-3)',
      fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)',
      lineHeight: 'var(--leading-relaxed)',
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
      <span style={{ flex: 1 }}>
        KI-Auto-Antwort nicht aktiv — trage einen OpenRouter API-Key in der <code>config.yaml</code> ein, um Nachrichten automatisch beantworten zu lassen.
      </span>
      <button type="button" onClick={() => setDismissed(true)} style={{
        background: 'none', border: 'none', color: 'var(--text-muted)',
        cursor: 'pointer', padding: 'var(--space-1)', flexShrink: 0,
        fontSize: 'var(--font-size-sm)', lineHeight: 1,
      }}>×</button>
    </div>
  );
}

function InboxView() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useConversations(25);
  const { data: responder } = useResponderStatus();
  const listEndRef = useRef<HTMLDivElement>(null);

  const pendingConversationIds = useMemo(() => new Set(
    responder?.pendingReplies?.filter(p => p.status === 'pending').map(p => p.conversationId) ?? [],
  ), [responder?.pendingReplies]);

  // Infinite scroll: load more when bottom sentinel is visible
  useEffect(() => {
    if (!listEndRef.current || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage(); },
      { threshold: 0.1 },
    );
    observer.observe(listEndRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleSelect = useCallback((id: string) => setSelectedId(id), []);
  const handleBack = useCallback(() => setSelectedId(null), []);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-10)', gap: 'var(--space-4)' }}>
        <Spinner size="lg" />
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>Nachrichten werden geladen...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-10)' }}>
        <EmptyState
          icon={
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 9v4M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
          title="Fehler beim Laden"
          message={(error as Error).message}
        />
      </div>
    );
  }

  const conversations = data?.pages.flatMap(p => p.conversations) ?? [];
  const totalUnread = data?.pages[0]?.numUnreadMessages ?? 0;
  const totalConversations = data?.pages[0]?._meta?.numFound ?? 0;

  return (
    <div className={`${styles.container} ${selectedId ? styles.containerChatOpen : ''}`}>
      <div className={styles.listPanel}>
        <div className={styles.listHeader}>
          <span className={styles.listTitle}>Nachrichten</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <AiBadge />
            {totalUnread > 0 && (
              <span className={styles.unreadBadge}>{totalUnread}</span>
            )}
          </div>
        </div>

        <AiUpsellBanner />

        {conversations.length === 0 ? (
          <EmptyState
            icon={
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
            title="Keine Nachrichten"
            message="Noch keine Konversationen vorhanden."
          />
        ) : (
          <>
            <ConversationList
              conversations={conversations}
              selectedId={selectedId}
              pendingConversationIds={pendingConversationIds}
              onSelect={handleSelect}
            />
            {/* Infinite scroll sentinel + counter */}
            <div ref={listEndRef} style={{ padding: 'var(--space-2)', textAlign: 'center' }}>
              {isFetchingNextPage ? (
                <Spinner size="sm" />
              ) : (
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>
                  {conversations.length} von {totalConversations}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className={styles.chatPanel}>
        {selectedId ? (
          <ChatView conversationId={selectedId} onBack={handleBack} />
        ) : (
          <div className={styles.chatEmpty}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            <span>Wähle eine Konversation aus</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const { data: status, isLoading } = useMessagingStatus();

  if (isLoading || !status) {
    return <StatusView status="not_started" />;
  }

  if (status.status !== 'ready') {
    return <StatusView status={status.status} error={status.error} />;
  }

  return <InboxView />;
}
