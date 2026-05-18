export function normalizeAdType(input: unknown): 'OFFER' | 'WANTED' {
  const raw = String(input ?? '').trim().toUpperCase();
  if (raw === 'WANTED' || raw === 'GESUCH' || raw === 'SUCHE' || raw === 'GESUCHT') return 'WANTED';
  if (raw === 'OFFER' || raw === 'ANGEBOT' || raw === 'VERKAUF') return 'OFFER';
  return 'OFFER';
}

export function normalizePriceType(input: unknown): 'FIXED' | 'NEGOTIABLE' | 'GIVE_AWAY' {
  const raw = String(input ?? '').trim().toUpperCase();
  if (raw === 'FIXED' || raw === 'FESTPREIS' || raw === 'FEST') return 'FIXED';
  if (raw === 'GIVE_AWAY' || raw === 'VERSCHENKEN' || raw === 'GRATIS' || raw === 'KOSTENLOS' || raw === 'UMSONST') return 'GIVE_AWAY';
  return 'NEGOTIABLE';
}

export function normalizeShippingType(input: unknown): 'PICKUP' | 'SHIPPING' | 'NOT_APPLICABLE' {
  const raw = String(input ?? '').trim().toUpperCase();
  if (raw === 'NOT_APPLICABLE') return 'NOT_APPLICABLE';
  if (raw === 'PICKUP' || raw === 'ABHOLUNG' || raw === 'SELBSTABHOLUNG' || raw === 'ABHOLEN') return 'PICKUP';
  return 'SHIPPING';
}
