// Single source of truth for Healthier/Marco Polo support contact info.
// Same WhatsApp number handles both product questions and technical support.
//
// Si cambia, hay que cambiarlo también en `mobile/src/lib/support.ts` — son
// dos repos, no hay import compartido.
export const SUPPORT_WHATSAPP_NUMBER = '5491172713599'

/** El mismo número, formateado para mostrarlo como texto. */
export const SUPPORT_PHONE_DISPLAY = '+54 9 11 7271-3599'

/** Para `href="tel:"` — E.164, sin espacios. */
export const SUPPORT_PHONE_E164 = '+5491172713599'

export function supportWhatsAppLink(message) {
  const base = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}`
  return message ? `${base}?text=${encodeURIComponent(message)}` : base
}
