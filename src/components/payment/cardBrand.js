/**
 * Shared Mercado Pago card-brand labels.
 *
 * MP returns `payment_method_id` strings ('visa', 'debmaster', ...) which we
 * persist verbatim in `payment_methods.card_brand`. Both the checkout selector
 * and the profile's saved-cards panel render them, so the mapping lives here.
 */

const BRAND_LABEL = {
  visa: 'Visa',
  master: 'Mastercard',
  amex: 'American Express',
  naranja: 'Naranja',
  cabal: 'Cabal',
  diners: 'Diners',
  debvisa: 'Visa Débito',
  debmaster: 'Mastercard Débito',
  debcabal: 'Cabal Débito',
}

export function brandLabel(raw) {
  if (!raw) return 'Tarjeta'
  return BRAND_LABEL[raw.toLowerCase()] ?? raw.charAt(0).toUpperCase() + raw.slice(1)
}

export default BRAND_LABEL
