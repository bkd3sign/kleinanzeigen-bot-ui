import { describe, it, expect } from 'vitest';
import { shouldSendOoo, repliedConversationsSince } from '../responder';

const conv = { boundness: 'INBOUND', role: 'Seller', adStatus: 'ACTIVE' };
const lastMsg = { boundness: 'INBOUND', type: 'MESSAGE' };
const ACTIVATED_AT = 1_000;
const AFTER = 2_000; // message received after activation
const BEFORE = 500; // message received before activation

describe('shouldSendOoo', () => {
  it('sends when an active seller conversation has a fresh inbound message after activation', () => {
    expect(shouldSendOoo(conv, lastMsg, false, AFTER, ACTIVATED_AT)).toBe(true);
  });

  it('does not send when the conversation was already answered this period', () => {
    expect(shouldSendOoo(conv, lastMsg, true, AFTER, ACTIVATED_AT)).toBe(false);
  });

  it('does not send to old threads whose last message predates activation', () => {
    expect(shouldSendOoo(conv, lastMsg, false, BEFORE, ACTIVATED_AT)).toBe(false);
  });

  it('does not send when the message timestamp is unparseable (NaN)', () => {
    expect(shouldSendOoo(conv, lastMsg, false, NaN, ACTIVATED_AT)).toBe(false);
  });

  it('does not send for outbound conversations', () => {
    expect(shouldSendOoo({ ...conv, boundness: 'OUTBOUND' }, lastMsg, false, AFTER, ACTIVATED_AT)).toBe(false);
  });

  it('does not send when the user is the buyer', () => {
    expect(shouldSendOoo({ ...conv, role: 'Buyer' }, lastMsg, false, AFTER, ACTIVATED_AT)).toBe(false);
  });

  it('does not send for inactive/deleted ads', () => {
    expect(shouldSendOoo({ ...conv, adStatus: 'DELETED' }, lastMsg, false, AFTER, ACTIVATED_AT)).toBe(false);
  });

  it('does not send when the last message is outbound (our own reply)', () => {
    expect(shouldSendOoo(conv, { ...lastMsg, boundness: 'OUTBOUND' }, false, AFTER, ACTIVATED_AT)).toBe(false);
  });

  it('does not send when the last message is not a regular message (e.g. rating)', () => {
    expect(shouldSendOoo(conv, { ...lastMsg, type: 'INTERACTION_RATING' }, false, AFTER, ACTIVATED_AT)).toBe(false);
  });
});

describe('repliedConversationsSince', () => {
  const log = [
    { conversationId: 'a', text: 'x', sentAt: 500 },  // before the period
    { conversationId: 'b', text: 'x', sentAt: 1_500 }, // this period
    { conversationId: 'c', text: 'x', sentAt: 2_000 }, // this period
  ];

  it('rebuilds the dedup set only from notes sent at/after the period start', () => {
    const set = repliedConversationsSince(log, 1_000);
    expect(set.has('b')).toBe(true);
    expect(set.has('c')).toBe(true);
    expect(set.has('a')).toBe(false); // previous period — buyer is eligible again
  });

  it('returns an empty set for a fresh period with no sends yet', () => {
    expect(repliedConversationsSince(log, 5_000).size).toBe(0);
  });

  it('dedupes repeated conversations in the log', () => {
    const set = repliedConversationsSince([...log, { conversationId: 'b', text: 'y', sentAt: 1_800 }], 1_000);
    expect(set.size).toBe(2);
  });
});
