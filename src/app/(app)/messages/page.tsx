'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMessagingStatus, useConversations, useResponderStatus, useSubmitMessagingMfa, usePrepareMessagingMfa, useStartMessaging } from '@/hooks/useMessages';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import { Spinner, EmptyState, Badge } from '@/components/ui';
import { ConversationList } from '@/components/messages/ConversationList';
import { ChatView } from '@/components/messages/ChatView';
import { MfaCodeInput } from '@/components/bot/MfaCodeInput';
import styles from '@/components/messages/Messages.module.scss';
import bannerStyles from '@/components/bot/MfaBanner.module.scss';

const STATUS_MESSAGES: Record<string, string> = {
  starting: 'Browser wird gestartet...',
  logging_in: 'Anmeldung bei Kleinanzeigen...',
  not_started: 'Messaging wird initialisiert...',
};

function MfaView() {
  const mfa = useSubmitMessagingMfa();
  const prepare = usePrepareMessagingMfa();

  const handleSubmit = useCallback(async (code: string) => {
    mfa.mutate(code);
  }, [mfa]);

  const handlePrepare = useCallback(async () => {
    prepare.mutate();
  }, [prepare]);

  return (
    <div className={styles.mfaContainer}>
      <MfaCodeInput
        title="MFA-Code erforderlich"
        description="Kleinanzeigen verlangt einen Bestätigungscode. Bitte hier eingeben."
        onSubmit={handleSubmit}
        onPrepare={handlePrepare}
        submitPending={mfa.isPending}
        preparePending={prepare.isPending}
      />
    </div>
  );
}

function BrowserlessBanner({ botCommand }: { botCommand?: string | null }) {
  return (
    <div className={styles.browserlessBanner}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <span>
        {botCommand
          ? `Bot führt „${botCommand}" aus… Nachrichten werden weiter beantwortet.`
          : 'Bot belegt den Browser. Nachrichten werden weiter beantwortet.'}
      </span>
    </div>
  );
}

function LoginView() {
  const start = useStartMessaging();

  return (
    <div className={styles.statusCenter}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
      <p className={styles.statusText}>
        Mit Kleinanzeigen verbinden um Nachrichten zu lesen und zu beantworten.
      </p>
      <button
        className={bannerStyles.btn}
        onClick={() => start.mutate()}
        disabled={start.isPending}
        style={{ marginTop: 'var(--space-2)', padding: 'var(--space-2) var(--space-6)' }}
      >
        {start.isPending ? 'Wird verbunden…' : 'Anmelden'}
      </button>
    </div>
  );
}

function StatusView({ status, error }: { status: string; error?: string }) {
  if (status === 'starting' || status === 'logging_in') {
    return (
      <div className={styles.statusCenter}>
        <Spinner size="lg" />
        <p className={styles.statusText}>
          {STATUS_MESSAGES[status] || 'Verbindung wird hergestellt...'}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.statusCenterRow}>
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

function InboxView({ botCommand }: { botCommand?: string | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useConversations(25);
  const { data: responder } = useResponderStatus();
  const listEndRef = useRef<HTMLDivElement>(null);

  // When conversations fail (e.g. session expired), re-check messaging status
  // so MessagesPage switches back to LoginView instead of stuck on error
  useEffect(() => {
    if (error) {
      queryClient.invalidateQueries({ queryKey: ['messaging-status'] });
    }
  }, [error, queryClient]);

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
        {botCommand !== undefined && <BrowserlessBanner botCommand={botCommand} />}

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
  const { data: responder } = useResponderStatus();

  if (isLoading || !status) {
    return <LoginView />;
  }

  // No session or failed session — show login button
  if (status.status === 'not_started' || status.status === 'error') {
    return <LoginView />;
  }

  // MFA required — global MfaOverlay handles this when KI is active (auto/review),
  // so only show inline MfaView when KI is off
  const kiActive = responder?.mode === 'auto' || responder?.mode === 'review';
  if (status.status === 'awaiting_mfa' && !kiActive) {
    return <MfaView />;
  }

  // Browserless mode — bot is running, API calls work only if we had a session before
  if (status.status === 'browserless') {
    if (!status.userId) {
      // Never had a session — can't load conversations without cookies
      return <StatusView status="starting" error={status.botCommand ? `Bot führt „${status.botCommand}" aus… Messaging startet danach automatisch.` : 'Bot läuft — Messaging startet nach Abschluss.'} />;
    }
    return <InboxView botCommand={status.botCommand} />;
  }

  if (status.status !== 'ready') {
    return <StatusView status={status.status} error={status.error} />;
  }

  return <InboxView />;
}
