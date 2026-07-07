export interface SellDirectlyInput {
  type?: 'OFFER' | 'WANTED' | null;
  shipping_type?: 'PICKUP' | 'SHIPPING' | 'NOT_APPLICABLE' | null;
  shipping_options?: string[] | null;
  price_type?: 'FIXED' | 'NEGOTIABLE' | 'GIVE_AWAY' | null;
}

export interface SellDirectlyCheck {
  ok: boolean;
  /** Reason why direct-buy is not allowed (German, UI-ready). Empty when ok. */
  reason: string;
  /** Form field the violation maps to — used for Zod issue paths. Null when ok. */
  field: 'shipping_type' | 'shipping_options' | 'price_type' | null;
}

const OK: SellDirectlyCheck = { ok: true, reason: '', field: null };

/**
 * Mirrors the bot's Ad._validate_sell_directly (model/ad_model.py): direct-buy
 * is only valid for non-WANTED ads with shipping_type SHIPPING, at least one
 * predefined shipping_options entry (custom shipping_costs alone is not enough),
 * and a FIXED or NEGOTIABLE price. WANTED ads are exempt — the bot silently
 * skips direct-buy handling for them.
 */
export function checkSellDirectly(ad: SellDirectlyInput): SellDirectlyCheck {
  if (ad.type === 'WANTED') return OK;
  if (ad.shipping_type !== 'SHIPPING') {
    return { ok: false, reason: 'Direktverkauf erfordert die Versandart „Versand".', field: 'shipping_type' };
  }
  if (!ad.shipping_options || ad.shipping_options.length === 0) {
    return {
      ok: false,
      reason: 'Direktverkauf erfordert mindestens eine vordefinierte Versandoption (Paketgröße).',
      field: 'shipping_options',
    };
  }
  if (ad.price_type !== 'FIXED' && ad.price_type !== 'NEGOTIABLE') {
    return { ok: false, reason: 'Direktverkauf erfordert den Preistyp „Festpreis" oder „Verhandlungsbasis".', field: 'price_type' };
  }
  return OK;
}
