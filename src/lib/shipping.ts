// Shipping size groups and carrier data shared between client (ShippingPicker) and server (AI route)

export const SHIPPING_SIZES = [
  {
    id: 'S' as const,
    label: 'Klein',
    example: 'z.B. Smartphone, T-Shirt …',
    carriers: [
      { value: 'DHL_2',           name: 'DHL Paket 2 kg',    price: 'ab 6,19 €', priceNum: 6.19,  detail: 'Max. 2 kg, max. 60 × 30 × 15 cm',                          tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
      { value: 'Hermes_Päckchen', name: 'Hermes Päckchen',   price: 'ab 4,89 €', priceNum: 4.89,  detail: 'Längste + kürzeste Seite zusammen max. 37 cm, max. 25 kg', tracking: 'Sendungsverfolgung und Haftung bis zu 50 €'  },
      { value: 'Hermes_S',        name: 'Hermes S-Paket',    price: 'ab 5,49 €', priceNum: 5.49,  detail: 'Längste + kürzeste Seite zusammen max. 50 cm, max. 25 kg', tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
    ],
  },
  {
    id: 'M' as const,
    label: 'Mittel',
    example: 'z.B. Schuhe, Spielekonsole …',
    carriers: [
      { value: 'DHL_5',    name: 'DHL Paket 5 kg',   price: 'ab 7,49 €', priceNum: 7.49, detail: 'Max. 5 kg, max. 120 × 60 × 60 cm',                            tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
      { value: 'Hermes_M', name: 'Hermes M-Paket',   price: 'ab 6,49 €', priceNum: 6.49, detail: 'Längste + kürzeste Seite zusammen max. 80 cm, max. 25 kg',  tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
    ],
  },
  {
    id: 'L' as const,
    label: 'Groß',
    example: 'z.B. Kleinmöbel …',
    carriers: [
      { value: 'DHL_10',   name: 'DHL Paket 10 kg',    price: 'ab 10,49 €', priceNum: 10.49, detail: 'Max. 10 kg, max. 120 × 60 × 60 cm',                           tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
      { value: 'DHL_20',   name: 'DHL Paket 20 kg',    price: 'ab 16,49 €', priceNum: 16.49, detail: 'Max. 20 kg, max. 120 × 60 × 60 cm',                           tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
      { value: 'DHL_31,5', name: 'DHL Paket 31,5 kg',  price: 'ab 19,99 €', priceNum: 19.99, detail: 'Max. 31,5 kg, max. 120 × 60 × 60 cm',                        tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
      { value: 'Hermes_L', name: 'Hermes L-Paket',     price: 'ab 11,49 €', priceNum: 11.49, detail: 'Längste + kürzeste Seite zusammen max. 120 cm, max. 25 kg', tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
    ],
  },
] as const;

export type ShippingSizeId = typeof SHIPPING_SIZES[number]['id'];

/** Returns all carrier values for the given size group. */
export function allCarriersOf(sizeId: ShippingSizeId): string[] {
  const group = SHIPPING_SIZES.find((s) => s.id === sizeId);
  if (!group) return [];
  return group.carriers.map((c) => c.value);
}

/** Returns the lowest price (as a number) for the given size group. */
export function cheapestPriceOf(sizeId: ShippingSizeId): number {
  const group = SHIPPING_SIZES.find((s) => s.id === sizeId);
  if (!group) return 0;
  return Math.min(...group.carriers.map((c) => c.priceNum));
}

/** Detects which size group the given option values belong to. */
export function detectSizeGroup(opts: string[]): ShippingSizeId | null {
  if (!opts || opts.length === 0) return null;
  for (const size of SHIPPING_SIZES) {
    if (opts.some((o) => size.carriers.some((c) => c.value === o))) return size.id;
  }
  return null;
}
