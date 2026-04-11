'use client';

import type { Conversation } from '@/types/message';
import styles from './Messages.module.scss';

interface ConversationListProps {
  conversations: Conversation[];
  selectedId: string | null;
  pendingConversationIds?: Set<string>;
  onSelect: (id: string) => void;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Gestern';
  if (diffDays < 7) return date.toLocaleDateString('de-DE', { weekday: 'short' });
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function adImageUrl(url: string): string {
  const directUrl = url.replace(/rule=.*$/, 'rule=$_2.JPG');
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  return `/api/messages/image?url=${encodeURIComponent(directUrl)}&token=${token ?? ''}`;
}

export function ConversationList({ conversations, selectedId, pendingConversationIds, onSelect }: ConversationListProps) {
  return (
    <div className={styles.list}>
      {conversations.map((conv) => {
        const contactName = conv.role === 'Seller' ? conv.buyerName : conv.sellerName;
        const isSelected = conv.id === selectedId;
        const isDeleted = conv.adStatus === 'DELETED';

        return (
          <button
            key={conv.id}
            className={`${styles.convItem} ${isSelected ? styles.convItemSelected : ''} ${conv.unread ? styles.convItemUnread : ''}`}
            onClick={() => onSelect(conv.id)}
          >
            <div className={styles.convImage}>
              <img
                src={adImageUrl(conv.adImage)}
                alt={conv.adTitle}
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              {isDeleted && (
                <div className={styles.convImagePlaceholder}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </div>
              )}
            </div>
            <div className={styles.convContent}>
              <div className={styles.convHeader}>
                <span className={styles.convName}>{contactName}</span>
                <span className={styles.convDate}>{formatDate(conv.receivedDate)}</span>
              </div>
              <div className={styles.convTitle}>
                {isDeleted && <span className={styles.convDeletedLabel}>Gelöscht · </span>}
                {conv.adTitle}
              </div>
              <div className={styles.convPreview}>
                {conv.boundness === 'OUTBOUND' && <span className={styles.convYou}>Du: </span>}
                {conv.textShortTrimmed}
              </div>
            </div>
            {pendingConversationIds?.has(conv.id) && (
              <span className={styles.convPending} title="KI-Vorschlag wartet auf Bestätigung">KI</span>
            )}
            {conv.unreadMessagesCount > 0 && (
              <span className={styles.convBadge}>{conv.unreadMessagesCount}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
