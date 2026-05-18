import { describe, it, expect } from 'vitest';
import { normalizeAdType, normalizePriceType, normalizeShippingType } from '../normalize';

describe('normalizeAdType', () => {
  it('passes through valid English values unchanged', () => {
    expect(normalizeAdType('OFFER')).toBe('OFFER');
    expect(normalizeAdType('WANTED')).toBe('WANTED');
  });

  it('maps German OFFER variants to OFFER', () => {
    expect(normalizeAdType('Angebot')).toBe('OFFER');
    expect(normalizeAdType('ANGEBOT')).toBe('OFFER');
    expect(normalizeAdType('Verkauf')).toBe('OFFER');
    expect(normalizeAdType('VERKAUF')).toBe('OFFER');
  });

  it('maps German WANTED variants to WANTED', () => {
    expect(normalizeAdType('Gesuch')).toBe('WANTED');
    expect(normalizeAdType('GESUCH')).toBe('WANTED');
    expect(normalizeAdType('Suche')).toBe('WANTED');
    expect(normalizeAdType('Gesucht')).toBe('WANTED');
  });

  it('defaults to OFFER for unknown/empty values', () => {
    expect(normalizeAdType(null)).toBe('OFFER');
    expect(normalizeAdType(undefined)).toBe('OFFER');
    expect(normalizeAdType('')).toBe('OFFER');
    expect(normalizeAdType('Sonstiges')).toBe('OFFER');
    expect(normalizeAdType(42)).toBe('OFFER');
  });
});

describe('normalizePriceType', () => {
  it('passes through valid English values unchanged', () => {
    expect(normalizePriceType('FIXED')).toBe('FIXED');
    expect(normalizePriceType('NEGOTIABLE')).toBe('NEGOTIABLE');
    expect(normalizePriceType('GIVE_AWAY')).toBe('GIVE_AWAY');
  });

  it('maps VHB variants to NEGOTIABLE', () => {
    expect(normalizePriceType('VHB')).toBe('NEGOTIABLE');
    expect(normalizePriceType('vhb')).toBe('NEGOTIABLE');
    expect(normalizePriceType('Verhandelbar')).toBe('NEGOTIABLE');
    expect(normalizePriceType('Verhandlungsbasis')).toBe('NEGOTIABLE');
    expect(normalizePriceType('VERHANDELBAR')).toBe('NEGOTIABLE');
  });

  it('maps Festpreis variants to FIXED', () => {
    expect(normalizePriceType('Festpreis')).toBe('FIXED');
    expect(normalizePriceType('FESTPREIS')).toBe('FIXED');
    expect(normalizePriceType('Fest')).toBe('FIXED');
  });

  it('maps Verschenken/Gratis variants to GIVE_AWAY', () => {
    expect(normalizePriceType('Verschenken')).toBe('GIVE_AWAY');
    expect(normalizePriceType('VERSCHENKEN')).toBe('GIVE_AWAY');
    expect(normalizePriceType('Gratis')).toBe('GIVE_AWAY');
    expect(normalizePriceType('gratis')).toBe('GIVE_AWAY');
    expect(normalizePriceType('Kostenlos')).toBe('GIVE_AWAY');
    expect(normalizePriceType('Umsonst')).toBe('GIVE_AWAY');
  });

  it('maps NOT_APPLICABLE and empty to NEGOTIABLE', () => {
    expect(normalizePriceType('NOT_APPLICABLE')).toBe('NEGOTIABLE');
    expect(normalizePriceType(null)).toBe('NEGOTIABLE');
    expect(normalizePriceType(undefined)).toBe('NEGOTIABLE');
    expect(normalizePriceType('')).toBe('NEGOTIABLE');
    expect(normalizePriceType('Unbekannt')).toBe('NEGOTIABLE');
  });
});

describe('normalizeShippingType', () => {
  it('passes through valid English values unchanged', () => {
    expect(normalizeShippingType('PICKUP')).toBe('PICKUP');
    expect(normalizeShippingType('SHIPPING')).toBe('SHIPPING');
    expect(normalizeShippingType('NOT_APPLICABLE')).toBe('NOT_APPLICABLE');
  });

  it('maps Versand variants to SHIPPING', () => {
    expect(normalizeShippingType('Versand')).toBe('SHIPPING');
    expect(normalizeShippingType('VERSAND')).toBe('SHIPPING');
    expect(normalizeShippingType('Versenden')).toBe('SHIPPING');
    expect(normalizeShippingType('Verschicken')).toBe('SHIPPING');
  });

  it('maps Abholung variants to PICKUP', () => {
    expect(normalizeShippingType('Abholung')).toBe('PICKUP');
    expect(normalizeShippingType('ABHOLUNG')).toBe('PICKUP');
    expect(normalizeShippingType('Selbstabholung')).toBe('PICKUP');
    expect(normalizeShippingType('Abholen')).toBe('PICKUP');
    expect(normalizeShippingType('SELBSTABHOLUNG')).toBe('PICKUP');
  });

  it('defaults to SHIPPING for unknown/empty values', () => {
    expect(normalizeShippingType(null)).toBe('SHIPPING');
    expect(normalizeShippingType(undefined)).toBe('SHIPPING');
    expect(normalizeShippingType('')).toBe('SHIPPING');
    expect(normalizeShippingType('Sonstiges')).toBe('SHIPPING');
  });
});
