'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useConversation, useSendMessage, useResponderStatus, useResponderControl } from '@/hooks/useMessages';
import { Spinner, Button } from '@/components/ui';
import type { Message } from '@/types/message';
import styles from './Messages.module.scss';

interface ChatViewProps {
  conversationId: string;
  onBack?: () => void;
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPrice(cents: number): string {
  return `${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)} €`;
}

function adImageUrl(url: string): string {
  const directUrl = url.replace(/rule=.*$/, 'rule=$_57.JPG');
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  return `/api/messages/image?url=${encodeURIComponent(directUrl)}&token=${token ?? ''}`;
}

function PendingReplyBanner({ conversationId }: { conversationId: string }) {
  const { data: responder } = useResponderStatus();
  const control = useResponderControl();
  const [editedReply, setEditedReply] = useState<string | null>(null);

  const pending = responder?.pendingReplies?.find(
    p => p.conversationId === conversationId && p.status === 'pending',
  );

  if (!pending) return null;

  const isEscalated = pending.suggestedReply.startsWith('[ESKALIERT]');
  const displayReply = editedReply ?? (isEscalated ? '' : pending.suggestedReply);

  return (
    <div className={styles.pendingBanner}>
      <div className={styles.pendingHeader}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 14v-4m0-4h.01" />
        </svg>
        <span>{isEscalated ? 'Eskaliert — Bitte manuell prüfen' : 'KI-Antwortvorschlag'}</span>
      </div>
      <textarea
        className={styles.pendingTextarea}
        value={displayReply}
        onChange={(e) => setEditedReply(e.target.value)}
        rows={3}
        placeholder={isEscalated ? 'Eigene Antwort schreiben...' : ''}
      />
      <div className={styles.pendingActions}>
        <Button
          variant="primary"
          size="sm"
          disabled={!displayReply.trim() || control.isPending}
          loading={control.isPending}
          onClick={() => control.mutate({
            action: 'approve',
            conversationId,
            editedMessage: displayReply.trim(),
          })}
        >
          Senden
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={control.isPending}
          onClick={() => control.mutate({ action: 'reject', conversationId })}
        >
          Verwerfen
        </Button>
      </div>
    </div>
  );
}

function MessageBubble({ message, isAiSent }: { message: Message; isAiSent?: boolean }) {
  if (message.type === 'INTERACTION_RATING') {
    return (
      <div className={styles.systemMessage}>
        <span>Bewertung {message.alreadyGiven ? 'abgegeben' : 'angefragt'}</span>
      </div>
    );
  }

  const isOutbound = message.boundness === 'OUTBOUND';
  const bubbleClass = isAiSent ? styles.bubbleAi : isOutbound ? styles.bubbleOut : styles.bubbleIn;

  return (
    <div className={`${styles.bubble} ${bubbleClass}`}>
      <div className={styles.bubbleText}>{message.textShort}</div>
      <span className={styles.bubbleTime}>
        {isAiSent && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '3px' }}>
            <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" /><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 14v4" />
          </svg>
        )}
        {formatTimestamp(message.receivedDate)}
      </span>
    </div>
  );
}

export function ChatView({ conversationId, onBack }: ChatViewProps) {
  const { data: conv, isLoading } = useConversation(conversationId);
  const sendMessage = useSendMessage();
  const [draft, setDraft] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conv?.messages?.length]);

  // Auto-resize textarea
  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  const handleSend = useCallback(() => {
    if (!draft.trim() || sendMessage.isPending) return;
    const message = draft.trim();
    setDraft('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    sendMessage.mutate(
      { conversationId, message },
      { onError: () => setDraft(message) },
    );
  }, [draft, conversationId, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  if (isLoading || !conv) {
    return (
      <div className={styles.chatLoading}>
        <Spinner size="md" />
      </div>
    );
  }

  const contactName = conv.role === 'Seller' ? conv.buyerName : conv.sellerName;
  const messages = conv.messages?.filter(m => m.textShort || m.type === 'INTERACTION_RATING') ?? [];
  const aiTexts = conv.aiSentTexts ?? [];
  const isAiMessage = (text: string) =>
    aiTexts.some(ai => ai.startsWith(text) || text.startsWith(ai));

  return (
    <div className={styles.chat}>
      {/* Chat header */}
      <div className={styles.chatHeader}>
        {onBack && (
          <button className={styles.chatBackBtn} onClick={onBack} title="Zurück">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
        <div className={styles.chatHeaderImageWrap}>
          <img
            src={adImageUrl(conv.adImage)}
            alt={conv.adTitle}
            className={styles.chatHeaderImage}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          {conv.adStatus === 'DELETED' && (
            <div className={styles.chatHeaderImageOverlay}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </div>
          )}
        </div>
        <div className={styles.chatHeaderInfo}>
          <h3 className={styles.chatHeaderName}>{contactName}</h3>
          <span className={styles.chatHeaderAd}>
            {conv.adStatus === 'DELETED' && <span className={styles.convDeletedLabel}>Gelöscht · </span>}
            {conv.adTitle}
            {conv.adPriceInEuroCent > 0 && (
              <span className={styles.chatHeaderPrice}>
                {' · '}{formatPrice(conv.adPriceInEuroCent)}
                {conv.adPriceType === 'NEGOTIABLE' && ' VB'}
                {conv.adPriceType === 'GIVE_AWAY' && ' Gratis'}
              </span>
            )}
            {conv.userActionRequired && <span className={styles.chatHeaderAction}> · Aktion nötig</span>}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className={styles.chatMessages}>
        {messages.map((msg) => (
          <MessageBubble
            key={msg.messageId}
            message={msg}
            isAiSent={msg.boundness === 'OUTBOUND' && isAiMessage(msg.textShort)}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* AI Pending Reply */}
      <PendingReplyBanner conversationId={conversationId} />

      {/* Input */}
      {conv.adStatus !== 'DELETED' && (
        <div className={styles.chatInput}>
          <textarea
            ref={textareaRef}
            className={styles.chatTextarea}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); handleInput(); }}
            onKeyDown={handleKeyDown}
            placeholder="Nachricht schreiben..."
            rows={1}
          />
          <button
            className={styles.chatSendBtn}
            onClick={handleSend}
            disabled={!draft.trim() || sendMessage.isPending}
          >
            {sendMessage.isPending ? '…' : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
