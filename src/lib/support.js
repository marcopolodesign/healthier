// Single source of truth for Healthier/Marco Polo support contact info.
// Same WhatsApp number handles both product questions and technical support.
export const SUPPORT_WHATSAPP_NUMBER = '525580207923'

export function supportWhatsAppLink(message) {
  const base = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}`
  return message ? `${base}?text=${encodeURIComponent(message)}` : base
}
