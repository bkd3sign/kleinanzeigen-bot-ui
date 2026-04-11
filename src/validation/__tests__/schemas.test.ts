import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  registerSchema,
  adCreateSchema,
  setupSchema,
  publishOptionsSchema,
  templateCreateSchema,
  configUpdateSchema,
} from '../schemas';

describe('loginSchema', () => {
  it('accepts valid login', () => {
    const result = loginSchema.safeParse({ email: 'test@example.de', password: 'pass123' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = loginSchema.safeParse({ email: 'notanemail', password: 'pass123' });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({ email: 'test@example.de', password: '' });
    expect(result.success).toBe(false);
  });
});

describe('registerSchema', () => {
  it('accepts valid registration', () => {
    const result = registerSchema.safeParse({
      email: 'new@example.de',
      password: 'securepass123',
      invite_token: 'abc123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects short password', () => {
    const result = registerSchema.safeParse({
      email: 'new@example.de',
      password: 'short',
      invite_token: 'abc123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing invite token', () => {
    const result = registerSchema.safeParse({
      email: 'new@example.de',
      password: 'securepass123',
      invite_token: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('adCreateSchema', () => {
  it('accepts valid ad', () => {
    const result = adCreateSchema.safeParse({
      type: 'OFFER',
      title: 'Deuter Trail 24L Wanderrucksack',
      description: 'Ein toller Rucksack für Wanderungen.',
      shipping_type: 'SHIPPING',
      shipping_costs: 5.49,
      price: 45,
      contact_name: 'Test',
      contact_zipcode: '10115',
      contact_location: 'Berlin',
      category: '210/241',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.price_type).toBe('NEGOTIABLE');
      expect(result.data.active).toBe(true);
      expect(result.data.type).toBe('OFFER');
    }
  });

  it('rejects title shorter than 10 chars', () => {
    const result = adCreateSchema.safeParse({
      title: 'Short',
      description: 'Description',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty description', () => {
    const result = adCreateSchema.safeParse({
      title: 'Valid Title Here 123',
      description: '',
    });
    expect(result.success).toBe(false);
  });

  it('validates special_attributes max entries', () => {
    const tooMany: Record<string, string> = {};
    for (let i = 0; i < 51; i++) {
      tooMany[`key${i}`] = `value${i}`;
    }
    const result = adCreateSchema.safeParse({
      title: 'Valid Title Here 123',
      description: 'Description',
      special_attributes: tooMany,
    });
    expect(result.success).toBe(false);
  });

  it('validates special_attributes max key length', () => {
    const result = adCreateSchema.safeParse({
      title: 'Valid Title Here 123',
      description: 'Description',
      special_attributes: { ['x'.repeat(201)]: 'value' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid price types', () => {
    for (const pt of ['FIXED', 'NEGOTIABLE', 'GIVE_AWAY']) {
      const result = adCreateSchema.safeParse({
        type: 'OFFER',
        title: 'Valid Title Here 123',
        description: 'Valid description text here',
        shipping_type: 'SHIPPING',
        shipping_costs: 4.99,
        price: 10,
        contact_name: 'Test',
        contact_zipcode: '12345',
        contact_location: 'Berlin',
        category: '161',
        price_type: pt,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid price type', () => {
    const result = adCreateSchema.safeParse({
      title: 'Valid Title Here 123',
      description: 'Description',
      price_type: 'INVALID',
    });
    expect(result.success).toBe(false);
  });
});

describe('setupSchema', () => {
  it('accepts valid setup data', () => {
    const result = setupSchema.safeParse({
      username: 'user@test.de',
      password: 'kleinanzeigen-pass',
      email: 'admin@test.de',
      web_password: 'securepass123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects short web_password', () => {
    const result = setupSchema.safeParse({
      username: 'user@test.de',
      password: 'pass',
      email: 'admin@test.de',
      web_password: 'short',
    });
    expect(result.success).toBe(false);
  });
});

describe('publishOptionsSchema', () => {
  it('uses default values', () => {
    const result = publishOptionsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ads).toBe('due');
      expect(result.data.force).toBe(false);
      expect(result.data.keep_old).toBe(false);
      expect(result.data.verbose).toBe(false);
    }
  });
});

describe('templateCreateSchema', () => {
  it('accepts valid template', () => {
    const result = templateCreateSchema.safeParse({
      name: 'Electronics Template',
      ad_data: { category: '161', price_type: 'NEGOTIABLE' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = templateCreateSchema.safeParse({
      name: '',
      ad_data: {},
    });
    expect(result.success).toBe(false);
  });
});

describe('configUpdateSchema', () => {
  it('accepts partial config update', () => {
    const result = configUpdateSchema.safeParse({
      ad_defaults: { price_type: 'FIXED' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = configUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
