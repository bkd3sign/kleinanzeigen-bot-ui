export interface AutoPriceReduction {
  enabled: boolean;
  strategy?: 'PERCENTAGE' | 'FIXED' | null;
  amount?: number | null;
  min_price?: number | null;
  delay_reposts?: number | null;
  delay_days?: number | null;
  on_update?: boolean | null;
}

export interface AdContact {
  name: string;
  street?: string;
  zipcode: string;
  location: string;
  phone?: string;
}

export type AdType = 'OFFER' | 'WANTED';
export type PriceType = 'FIXED' | 'NEGOTIABLE' | 'GIVE_AWAY';
export type ShippingType = 'PICKUP' | 'SHIPPING' | 'NOT_APPLICABLE';

export interface Ad {
  id?: number;
  active: boolean;
  type: AdType;
  title: string;
  description: string;
  category: string;
  price?: number;
  price_type: PriceType;
  shipping_type: ShippingType;
  shipping_costs?: number;
  shipping_options?: string[];
  sell_directly?: boolean;
  images: string[];
  contact?: AdContact;
  republication_interval?: number;
  description_prefix?: string;
  description_suffix?: string;
  special_attributes?: Record<string, string | number | boolean>;
  auto_price_reduction?: AutoPriceReduction;
  created_on?: string;
  updated_on?: string;
  content_hash?: string;
  repost_count?: number;
  price_reduction_count?: number;
  file?: string;
}

export interface AdListItem {
  id?: number;
  title: string;
  price?: number;
  price_type?: PriceType;
  active: boolean;
  type: AdType;
  category?: string;
  images: number;
  first_image?: string | null;
  created_on?: string;
  updated_on?: string;
  repost_count: number;
  republication_interval?: number;
  shipping_type?: ShippingType;
  auto_price_reduction?: AutoPriceReduction;
  price_reduction_count: number;
  has_description: boolean;
  is_changed: boolean;
  is_orphaned: boolean;
  file: string;
}

export interface AdCreate {
  title: string;
  description: string;
  category?: string | null;
  price?: number | null;
  price_type?: PriceType;
  shipping_type?: ShippingType;
  shipping_costs?: number | null;
  shipping_options?: string[] | null;
  sell_directly?: boolean | null;
  images?: string[] | null;
  contact_name?: string | null;
  contact_zipcode?: string | null;
  contact_location?: string | null;
  contact_street?: string | null;
  contact_phone?: string | null;
  republication_interval?: number | null;
  active?: boolean | null;
  type?: AdType;
  description_prefix?: string | null;
  description_suffix?: string | null;
  special_attributes?: Record<string, string | number | boolean> | null;
  auto_price_reduction?: AutoPriceReduction | null;
}

export interface AdUpdate extends Partial<AdCreate> {}
