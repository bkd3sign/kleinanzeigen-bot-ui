import { z } from 'zod';

// Auth schemas
export const loginSchema = z.object({
  email: z.string().email('Ungültige E-Mail-Adresse'),
  password: z.string().min(1, 'Passwort erforderlich'),
});

export const registerSchema = z.object({
  email: z.string().email('Ungültige E-Mail-Adresse'),
  password: z.string().min(8, 'Passwort muss mindestens 8 Zeichen haben'),
  display_name: z.string().optional(),
  invite_token: z.string().min(1, 'Einladungscode erforderlich'),
});

export const profileUpdateSchema = z.object({
  display_name: z.string().optional(),
  password: z.string().min(8, 'Passwort muss mindestens 8 Zeichen haben').optional().or(z.literal('')),
});

export const adminUserUpdateSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  display_name: z.string().optional(),
});

// Ad schemas
export const autoPriceReductionSchema = z.object({
  enabled: z.boolean(),
  strategy: z.enum(['PERCENTAGE', 'FIXED']).nullable().optional(),
  amount: z.number({ invalid_type_error: 'Betrag muss eine Zahl sein' }).nullable().optional(),
  min_price: z.number({ invalid_type_error: 'Mindestpreis muss eine Zahl sein' }).nullable().optional(),
  delay_reposts: z.number().int().min(0).nullable().optional().default(0),
  delay_days: z.number().int().min(0).nullable().optional().default(0),
  on_update: z.boolean().nullable().optional().default(false),
});

const specialAttributesSchema = z.record(
  z.string().max(200),
  z.union([z.string().max(200), z.number(), z.boolean()])
).transform((val) =>
  // Coerce all values to strings — the bot requires string-type special_attributes
  Object.fromEntries(Object.entries(val).map(([k, v]) => [k, String(v)]))
).pipe(z.record(z.string().max(200), z.string())).refine(
  (val) => Object.keys(val).length <= 50,
  { message: 'Maximal 50 Einträge erlaubt' }
);

export const adCreateSchema = z.object({
  type: z.enum(['OFFER', 'WANTED'], { required_error: 'Angebot/Gesuch ist erforderlich' }),
  title: z.string().min(10, 'Titel muss mindestens 10 Zeichen haben').max(65, 'Titel darf maximal 65 Zeichen haben'),
  description: z.string().min(10, 'Beschreibung muss mindestens 10 Zeichen haben').max(4000, 'Beschreibung darf maximal 4000 Zeichen haben'),
  shipping_type: z.enum(['PICKUP', 'SHIPPING', 'NOT_APPLICABLE'], { required_error: 'Versandart ist erforderlich' }),
  price: z.coerce.number({ required_error: 'Preis ist erforderlich', invalid_type_error: 'Preis muss eine Zahl sein' }).min(0, 'Preis darf nicht negativ sein'),
  contact_name: z.string().min(1, 'Name darf nicht leer sein').optional(),
  contact_zipcode: z.string().min(1, 'PLZ darf nicht leer sein').optional(),
  contact_location: z.string().min(1, 'Ort darf nicht leer sein').optional(),
  category: z.string({ required_error: 'Kategorie ist erforderlich' }).min(1, 'Kategorie darf nicht leer sein'),
  price_type: z.enum(['FIXED', 'NEGOTIABLE', 'GIVE_AWAY']).default('NEGOTIABLE'),
  shipping_costs: z.coerce.number({ invalid_type_error: 'Versandkosten müssen eine Zahl sein' }).positive('Versandkosten müssen positiv sein').nullable().optional(),
  shipping_options: z.array(z.string()).nullable().optional().default([]),
  sell_directly: z.boolean().nullable().optional().default(false),
  images: z.array(z.string()).nullable().optional().default([]),
  contact_street: z.string().nullable().optional().default(''),
  contact_phone: z.string().nullable().optional().default(''),
  republication_interval: z.number({ invalid_type_error: 'Intervall muss eine Zahl sein' }).int().positive('Intervall muss positiv sein').nullable().optional(),
  active: z.boolean().nullable().optional().default(true),
  description_prefix: z.string().max(500, 'Präfix darf maximal 500 Zeichen haben').nullable().optional().default(''),
  description_suffix: z.string().max(500, 'Suffix darf maximal 500 Zeichen haben').nullable().optional().default(''),
  special_attributes: specialAttributesSchema.nullable().optional().default({}),
  auto_price_reduction: autoPriceReductionSchema.nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.shipping_type !== 'SHIPPING') return;
  const hasOptions = data.shipping_options && data.shipping_options.length > 0;
  const hasCosts = data.shipping_costs != null && data.shipping_costs > 0;
  if (!hasOptions && !hasCosts) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Bitte wähle eine Versandoption (Paketgröße oder individueller Preis)',
      path: ['shipping_costs'],
    });
  }
});

const adCreateBaseSchema = adCreateSchema.innerType();
export const adUpdateSchema = adCreateBaseSchema.partial();

// Bot schemas
export const publishOptionsSchema = z.object({
  ads: z.string().default('due'),
  force: z.boolean().default(false),
  keep_old: z.boolean().default(false),
  verbose: z.boolean().default(false),
});

export const downloadOptionsSchema = z.object({
  ads: z.string().default('new'),
  verbose: z.boolean().default(false),
});

export const updateOptionsSchema = z.object({
  ads: z.string().default('changed'),
  verbose: z.boolean().default(false),
});

export const extendOptionsSchema = z.object({
  ads: z.string().default('all'),
  verbose: z.boolean().default(false),
});

export const deleteOptionsSchema = z.object({
  ads: z.string().default('all'),
  verbose: z.boolean().default(false),
});

// Setup schema
export const setupSchema = z.object({
  username: z.string().min(1, 'Benutzername erforderlich'),
  password: z.string().min(1, 'Passwort erforderlich'),
  contact_name: z.string().default(''),
  contact_zipcode: z.string().default(''),
  contact_location: z.string().default(''),
  email: z.string().email('Ungültige E-Mail-Adresse'),
  web_password: z.string().min(8, 'Passwort muss mindestens 8 Zeichen haben'),
  display_name: z.string().default(''),
  openrouter_api_key: z.string().default(''),
});

// Config schema
export const configUpdateSchema = z.object({
  ad_defaults: z.record(z.unknown()).optional(),
  publishing: z.record(z.unknown()).optional(),
  deleting: z.object({
    after_delete: z.enum(['NONE', 'RESET', 'DISABLE']),
  }).optional(),
  timeouts: z.record(z.unknown()).optional(),
  download: z.record(z.unknown()).optional(),
  update_check: z.record(z.unknown()).optional(),
  login: z.record(z.unknown()).optional(),
});

// Template schemas
export const templateCreateSchema = z.object({
  name: z.string().min(1, 'Name erforderlich'),
  description: z.string().default(''),
  locked_fields: z.array(z.string()).default([]),
  ad_data: z.record(z.unknown()),
});

export const templateUpdateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  locked_fields: z.array(z.string()).optional(),
  ad_data: z.record(z.unknown()).optional(),
});

// AI generation schema
export const aiGenerateSchema = z.object({
  prompt: z.string().max(10000).default(''),
  images: z.array(z.string()).max(10, 'Maximal 10 Bilder erlaubt').default([]),
});

// Inferred types
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type AdCreateInput = z.infer<typeof adCreateSchema>;
export type AdUpdateInput = z.infer<typeof adUpdateSchema>;
export type SetupInput = z.infer<typeof setupSchema>;
