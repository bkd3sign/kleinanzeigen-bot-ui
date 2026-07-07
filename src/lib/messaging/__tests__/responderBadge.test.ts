import { describe, it, expect } from 'vitest';
import { getResponderBadge, canLoadInbox, isResponderActive } from '../responderBadge';

describe('getResponderBadge', () => {
  it('returns null for off / undefined', () => {
    expect(getResponderBadge('off', true)).toBeNull();
    expect(getResponderBadge(undefined, true)).toBeNull();
  });

  it('hides KI modes when no API key is available', () => {
    expect(getResponderBadge('auto', false)).toBeNull();
    expect(getResponderBadge('review', false)).toBeNull();
  });

  it('shows out-of-office even without an API key', () => {
    expect(getResponderBadge('out_of_office', false)).toEqual({
      variant: 'warning', short: 'Away', long: 'Abwesenheit aktiv',
    });
  });

  it('labels auto and review when AI is available', () => {
    expect(getResponderBadge('auto', true)).toEqual({ variant: 'success', short: 'Auto', long: 'KI Auto' });
    expect(getResponderBadge('review', true)).toEqual({ variant: 'info', short: 'Review', long: 'KI Review' });
  });

  it('shows a red Login badge when an active mode cannot load the inbox', () => {
    const expected = { variant: 'danger', short: 'Login', long: 'Login' };
    expect(getResponderBadge('out_of_office', false, false)).toEqual(expected);
    expect(getResponderBadge('auto', true, false)).toEqual(expected);
    expect(getResponderBadge('review', true, false)).toEqual(expected);
  });

  it('stays null for off even when the inbox cannot load', () => {
    expect(getResponderBadge('off', true, false)).toBeNull();
  });

  it('defaults to the calm mode badge when inbox loadability is unspecified', () => {
    expect(getResponderBadge('out_of_office', false)).toEqual({ variant: 'warning', short: 'Away', long: 'Abwesenheit aktiv' });
  });
});

describe('canLoadInbox', () => {
  it('is true for a ready session', () => {
    expect(canLoadInbox('ready', false)).toBe(true);
  });

  it('is true for browserless only with a cached userId', () => {
    expect(canLoadInbox('browserless', true)).toBe(true);
    expect(canLoadInbox('browserless', false)).toBe(false);
  });

  it('is false for awaiting_mfa, not_started, error and undefined', () => {
    expect(canLoadInbox('awaiting_mfa', true)).toBe(false);
    expect(canLoadInbox('not_started', true)).toBe(false);
    expect(canLoadInbox('error', true)).toBe(false);
    expect(canLoadInbox(undefined, true)).toBe(false);
  });

  it('treats browserless as loadable when userId is unknown (admin overview)', () => {
    expect(canLoadInbox('browserless')).toBe(true);
  });
});

describe('isResponderActive', () => {
  it('is true for the polling modes', () => {
    expect(isResponderActive('auto')).toBe(true);
    expect(isResponderActive('review')).toBe(true);
    expect(isResponderActive('out_of_office')).toBe(true);
  });

  it('is false for off / undefined', () => {
    expect(isResponderActive('off')).toBe(false);
    expect(isResponderActive(undefined)).toBe(false);
  });
});
