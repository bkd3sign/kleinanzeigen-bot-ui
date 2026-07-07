import { SHIPPING_SIZES } from '@/lib/shipping';

const SHIPPING_SIZE_LABELS: Record<string, string> = Object.fromEntries(
  SHIPPING_SIZES.map((s) => [s.id, s.label]),
);

const SHIPPING_TYPE_LABELS: Record<string, string> = {
  SHIPPING: 'Versand möglich',
  PICKUP: 'Nur Abholung',
};

interface AdEnumFields {
  type?: string;
  price_type?: string;
  shipping_type?: string;
  shipping_size?: string;
}

// Returns pre-formatted plain pill labels for top-level AI-selected enum fields.
// VB/Festpreis are not included here — they appear in the price display instead.
export function buildEnumChipLabels(ad: AdEnumFields): string[] {
  const labels: string[] = [];
  if (ad.type === 'WANTED') labels.push('Gesucht');
  if (ad.price_type === 'GIVE_AWAY') labels.push('Zu verschenken');
  const shippingLabel = SHIPPING_TYPE_LABELS[ad.shipping_type ?? ''];
  if (shippingLabel) labels.push(shippingLabel);
  const sizeLabel = SHIPPING_SIZE_LABELS[ad.shipping_size ?? ''];
  if (sizeLabel) labels.push(`Paket: ${sizeLabel}`);
  return labels;
}
