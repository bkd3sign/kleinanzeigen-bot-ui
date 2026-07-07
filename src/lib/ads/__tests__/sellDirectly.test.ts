import { describe, expect, it } from 'vitest';
import { checkSellDirectly } from '../sellDirectly';

describe('checkSellDirectly', () => {
  const valid = {
    type: 'OFFER' as const,
    shipping_type: 'SHIPPING' as const,
    shipping_options: ['DHL_2'],
    price_type: 'FIXED' as const,
  };

  it('accepts a valid OFFER with SHIPPING, predefined options and FIXED price', () => {
    expect(checkSellDirectly(valid)).toEqual({ ok: true, reason: '', field: null });
  });

  it('accepts NEGOTIABLE price', () => {
    expect(checkSellDirectly({ ...valid, price_type: 'NEGOTIABLE' }).ok).toBe(true);
  });

  it('exempts WANTED ads regardless of other fields', () => {
    expect(checkSellDirectly({ type: 'WANTED', shipping_type: 'PICKUP', shipping_options: null, price_type: 'GIVE_AWAY' }).ok).toBe(true);
  });

  it('rejects non-SHIPPING shipping_type', () => {
    const r = checkSellDirectly({ ...valid, shipping_type: 'PICKUP' });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('shipping_type');
  });

  it('rejects empty shipping_options (custom costs alone are not enough)', () => {
    expect(checkSellDirectly({ ...valid, shipping_options: [] }).field).toBe('shipping_options');
    expect(checkSellDirectly({ ...valid, shipping_options: null }).field).toBe('shipping_options');
  });

  it('rejects GIVE_AWAY price_type', () => {
    const r = checkSellDirectly({ ...valid, price_type: 'GIVE_AWAY' });
    expect(r.ok).toBe(false);
    expect(r.field).toBe('price_type');
  });

  it('reports the shipping_type violation before others', () => {
    // No options AND wrong shipping_type → shipping_type is checked first (matches bot order)
    const r = checkSellDirectly({ type: 'OFFER', shipping_type: 'PICKUP', shipping_options: [], price_type: 'GIVE_AWAY' });
    expect(r.field).toBe('shipping_type');
  });

  it('returns a German, non-empty reason on every failure', () => {
    for (const bad of [
      { ...valid, shipping_type: 'PICKUP' as const },
      { ...valid, shipping_options: [] },
      { ...valid, price_type: 'GIVE_AWAY' as const },
    ]) {
      expect(checkSellDirectly(bad).reason.length).toBeGreaterThan(0);
    }
  });
});
