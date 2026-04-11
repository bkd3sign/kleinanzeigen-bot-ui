// Kleinanzeigen Gateway Messaging API types

export interface Conversation {
  id: string;
  role: 'Seller' | 'Buyer';
  buyerName: string;
  sellerName: string;
  buyerInitials: string;
  sellerInitials: string;
  userIdBuyer: number;
  userIdSeller: number;
  adId: string;
  adTitle: string;
  adStatus: 'ACTIVE' | 'DELETED';
  adImage: string;
  adPriceType: 'NEGOTIABLE' | 'FIXED' | 'GIVE_AWAY' | 'NOT_APPLICABLE';
  adL1CategoryId: string;
  adL2CategoryId: string;
  adType: 'OFFER' | 'WANTED';
  adDetailsAvailable: boolean;
  unread: boolean;
  unreadMessagesCount: number;
  textShortTrimmed: string;
  boundness: 'INBOUND' | 'OUTBOUND';
  receivedDate: string;
  ratingPossible: boolean;
  userActionRequired: boolean;
  flaggingEnabled: boolean;
}

export interface Message {
  messageId: string;
  textShort: string;
  boundness: 'INBOUND' | 'OUTBOUND';
  type: 'MESSAGE' | 'INTERACTION_RATING';
  receivedDate: string;
  attachments: unknown[];
  title?: string;
  submissionEnabled?: boolean;
  alreadyGiven?: boolean;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
  adPriceInEuroCent: number;
  linksEnabled: boolean;
  attachmentsEnabled: boolean;
  paymentPossible: boolean;
  buyNowPossible: boolean;
  buyerRegistrationDate: string;
  sellerRegistrationDate: string;
  numUnread: number;
}

export interface ConversationsResponse {
  numUnread: number;
  numUnreadMessages: number;
  lastModified: string;
  conversations: Conversation[];
  _meta: {
    numFound: number;
    pageNum: number;
    pageSize: number;
    numUnread: number;
    numUnreadMessages: number;
    attachmentsEnabled: boolean;
  };
}
