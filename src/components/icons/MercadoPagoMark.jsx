/**
 * Logo de Mercado Pago.
 *
 * Mismo criterio que `WhatsAppMark`: el `CLAUDE.md` dice `@phosphor-icons/react`
 * ÚNICAMENTE, y esa regla existe para que no convivan varias librerías de
 * iconografía con estilos distintos. El logo de una marca de un tercero es otra
 * cosa — tiene una forma canónica y no se puede sustituir por una interpretación.
 * Hasta ahora las tarjetas de Mercado Pago usaban un `LinkSimple` y un
 * `CheckCircle` genéricos, que no dicen de qué se está hablando.
 *
 * Es un PNG y no un SVG porque es el archivo que pasó Mateo (2026-07-31). Está a
 * 96x96, o sea 3x del tamaño al que se usa: se ve bien en pantallas retina.
 */
export default function MercadoPagoMark({ className = 'w-8 h-8' }) {
  return (
    <img
      src="/images/mercadopago.png"
      alt="Mercado Pago"
      width={96}
      height={96}
      loading="lazy"
      className={className}
    />
  )
}
