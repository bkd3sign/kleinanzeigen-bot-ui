import { describe, it, expect } from 'vitest';
import { allCarriersOf, cheapestPriceOf, detectSizeGroup, SHIPPING_SIZES } from '../shipping';

describe('allCarriersOf', () => {
  it('returns S carriers', () => {
    expect(allCarriersOf('S')).toEqual(['DHL_2', 'Hermes_Päckchen', 'Hermes_S']);
  });

  it('returns M carriers', () => {
    expect(allCarriersOf('M')).toEqual(['DHL_5', 'Hermes_M']);
  });

  it('returns L carriers', () => {
    expect(allCarriersOf('L')).toEqual(['DHL_10', 'DHL_20', 'DHL_31,5', 'Hermes_L']);
  });

  it('returns empty array for unknown size', () => {
    expect(allCarriersOf('XL' as never)).toEqual([]);
  });
});

describe('cheapestPriceOf', () => {
  it('returns cheapest S price (Hermes Päckchen)', () => {
    expect(cheapestPriceOf('S')).toBe(4.89);
  });

  it('returns cheapest M price (Hermes M)', () => {
    expect(cheapestPriceOf('M')).toBe(6.49);
  });

  it('returns cheapest L price (DHL 10kg)', () => {
    expect(cheapestPriceOf('L')).toBe(10.49);
  });

  it('returns 0 for unknown size', () => {
    expect(cheapestPriceOf('XL' as never)).toBe(0);
  });
});

describe('detectSizeGroup', () => {
  it('detects S from DHL_2', () => {
    expect(detectSizeGroup(['DHL_2'])).toBe('S');
  });

  it('detects S from Hermes_Päckchen', () => {
    expect(detectSizeGroup(['Hermes_Päckchen'])).toBe('S');
  });

  it('detects M from DHL_5', () => {
    expect(detectSizeGroup(['DHL_5'])).toBe('M');
  });

  it('detects L from DHL_31,5', () => {
    expect(detectSizeGroup(['DHL_31,5'])).toBe('L');
  });

  it('detects from multiple carriers in same group', () => {
    expect(detectSizeGroup(['DHL_5', 'Hermes_M'])).toBe('M');
  });

  it('returns null for empty array', () => {
    expect(detectSizeGroup([])).toBeNull();
  });

  it('returns null for unknown carrier', () => {
    expect(detectSizeGroup(['UPS_Express'])).toBeNull();
  });
});

describe('SHIPPING_SIZES data integrity', () => {
  it('has exactly 3 size groups', () => {
    expect(SHIPPING_SIZES).toHaveLength(3);
  });

  it('all carriers have required fields', () => {
    for (const size of SHIPPING_SIZES) {
      for (const carrier of size.carriers) {
        expect(carrier.value).toBeTruthy();
        expect(carrier.name).toBeTruthy();
        expect(carrier.priceNum).toBeGreaterThan(0);
      }
    }
  });

  it('all prices are positive numbers', () => {
    for (const size of SHIPPING_SIZES) {
      for (const carrier of size.carriers) {
        expect(carrier.priceNum).toBeGreaterThan(0);
        expect(typeof carrier.priceNum).toBe('number');
      }
    }
  });
});
