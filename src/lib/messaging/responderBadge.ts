import type { BadgeVariant } from '@/components/ui/Badge/Badge';

export type ResponderMode = 'auto' | 'review' | 'off' | 'out_of_office';

export interface ResponderBadge {
  variant: BadgeVariant;
  /** Compact label for the navigation link. */
  short: string;
  /** Verbose label for the inbox header badge. */
  long: string;
}

/**
 * Modes in which the responder is actively polling — and thus depends on a live messaging session.
 * Single source of truth: badge, MFA overlay and inbox-page gating must agree on this set.
 */
export function isResponderActive(mode: ResponderMode | undefined): boolean {
  return mode === 'auto' || mode === 'review' || mode === 'out_of_office';
}

/**
 * Whether the messaging session can currently load/serve the inbox — and thus let any responder
 * mode actually send or suggest. Cookie+HTTP mode (`browserless`) works only with a cached userId.
 */
export function canLoadInbox(status: string | undefined, hasUserId: boolean = true): boolean {
  return status === 'ready' || (status === 'browserless' && hasUserId);
}

/**
 * Map the responder mode to a status badge, or null when none should show.
 * KI modes (auto/review) require an OpenRouter key; out-of-office does not.
 * When a mode is active but the inbox can't load, the mode silently does nothing — so we surface
 * a loud red "Login" badge instead of the calm mode badge.
 */
export function getResponderBadge(
  mode: ResponderMode | undefined,
  isAiAvailable: boolean,
  inboxLoadable: boolean = true,
): ResponderBadge | null {
  if (!mode || mode === 'off') return null;
  if (mode !== 'out_of_office' && !isAiAvailable) return null;
  if (!inboxLoadable) return { variant: 'danger', short: 'Login', long: 'Login' };

  switch (mode) {
    case 'auto': return { variant: 'success', short: 'Auto', long: 'KI Auto' };
    case 'review': return { variant: 'info', short: 'Review', long: 'KI Review' };
    case 'out_of_office': return { variant: 'warning', short: 'Away', long: 'Abwesenheit aktiv' };
    default: return null;
  }
}
