// Shipping size groups and carrier data shared between client (ShippingPicker) and server (AI route)

export const SHIPPING_SIZES = [
  {
    id: 'S' as const,
    label: 'Klein',
    example: 'z.B. Smartphone, T-Shirt …',
    carriers: [
      { value: 'DHL_2',           name: 'DHL Paket 2 kg',    price: 'ab 6,19 €', priceNum: 6.19,  detail: 'Max. 2 kg, max. 60 × 30 × 15 cm',                          tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
      { value: 'Hermes_Päckchen', name: 'Hermes Päckchen',   price: 'ab 5,19 €', priceNum: 5.19,  detail: 'Längste + kürzeste Seite zusammen max. 37 cm, max. 25 kg', tracking: 'Sendungsverfolgung und Haftung bis zu 50 €'  },
      { value: 'Hermes_S',        name: 'Hermes S-Paket',    price: 'ab 5,79 €', priceNum: 5.79,  detail: 'Längste + kürzeste Seite zusammen max. 50 cm, max. 25 kg', tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
    ],
  },
  {
    id: 'M' as const,
    label: 'Mittel',
    example: 'z.B. Schuhe, Spielekonsole …',
    carriers: [
      { value: 'DHL_5',    name: 'DHL Paket 5 kg',   price: 'ab 7,69 €', priceNum: 7.69, detail: 'Max. 5 kg, max. 120 × 60 × 60 cm',                            tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
      { value: 'Hermes_M', name: 'Hermes M-Paket',   price: 'ab 6,99 €', priceNum: 6.99, detail: 'Längste + kürzeste Seite zusammen max. 80 cm, max. 25 kg',  tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
    ],
  },
  {
    id: 'L' as const,
    label: 'Groß',
    example: 'z.B. Kleinmöbel …',
    carriers: [
      { value: 'DHL_10',   name: 'DHL Paket 10 kg',    price: 'ab 10,49 €', priceNum: 10.49, detail: 'Max. 10 kg, max. 120 × 60 × 60 cm',                           tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
      { value: 'DHL_20',   name: 'DHL Paket 20 kg',    price: 'ab 18,99 €', priceNum: 18.99, detail: 'Max. 20 kg, max. 120 × 60 × 60 cm',                           tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
      { value: 'DHL_31,5', name: 'DHL Paket 31,5 kg',  price: 'ab 23,99 €', priceNum: 23.99, detail: 'Max. 31,5 kg, max. 120 × 60 × 60 cm',                        tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
      { value: 'Hermes_L', name: 'Hermes L-Paket',     price: 'ab 10,99 €', priceNum: 10.99, detail: 'Längste + kürzeste Seite zusammen max. 120 cm, max. 25 kg', tracking: 'Sendungsverfolgung und Haftung bis zu 500 €' },
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

/** Returns the OptionItem description for a size group: example text + cheapest carrier price. */
export function sizeDescOf(sizeId: ShippingSizeId): string {
  const group = SHIPPING_SIZES.find((s) => s.id === sizeId);
  if (!group) return '';
  const cheapest = [...group.carriers].sort((a, b) => a.priceNum - b.priceNum)[0];
  return `${group.example.replace(' …', '')} · ${cheapest.price}`;
}

/** Detects which size group the given option values belong to. */
export function detectSizeGroup(opts: string[]): ShippingSizeId | null {
  if (!opts || opts.length === 0) return null;
  for (const size of SHIPPING_SIZES) {
    if (opts.some((o) => size.carriers.some((c) => c.value === o))) return size.id;
  }
  return null;
}
