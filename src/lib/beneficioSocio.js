// Descuento de socio comercial (LIFT, migración 252) — sólo para MOSTRAR.
// El monto real lo calcula el servidor al cobrar (mp-payment); esto replica la
// misma cuenta (redondeo a 2 decimales) para que el precio que se ve coincida.
export function descuentoSocio(beneficio, precio) {
  if (!beneficio?.disponible || !(precio > 0)) return 0
  const pct = Number(beneficio.porcentaje) || 0
  return Math.min(Math.round(precio * pct * 100) / 100, precio)
}

export function etiquetaBeneficio(beneficio) {
  if (!beneficio) return ''
  return `Beneficio ${beneficio.socioNombre} (${Math.round(Number(beneficio.porcentaje) * 100)}%)`
}
