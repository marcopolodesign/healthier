/**
 * Orden del carrusel "Atención inmediata" (Mateo, 2026-10-16): todas las
 * verticales habilitadas, PRIMERO las que tienen a alguien en línea ahora y el
 * resto detrás (apagadas, a sacar turno). Dentro de cada grupo, el orden que
 * fija el super admin (`sortOrder`, ya viene ordenado de `useVerticales`).
 *
 * Sin imports a propósito: lo prueba `scripts/verificar-carrusel-verticales.mjs`
 * con node, sin levantar la app. Mismo criterio en mobile
 * (`src/lib/carruselVerticales.ts`).
 *
 * @param verticales  [{ id, comingSoon, ... }] en orden del admin
 * @param porVertical { [verticalId]: [slugs] } — de `useEspecialidades()`
 * @param pros        profesionales on demand con presencia vigente
 * @param estaDisponible (pro) => bool — `disponibleAhora` de professionalService
 */
export function ordenarCarrusel(verticales, porVertical, pros, estaDisponible = () => true) {
  const conDisponibilidad = (verticales ?? [])
    .filter(v => !v.comingSoon)
    .map(v => {
      const slugs = porVertical?.[v.id] || []
      return { ...v, disponible: (pros ?? []).some(p => slugs.includes(p.specialty) && estaDisponible(p)) }
    })
  return [
    ...conDisponibilidad.filter(v => v.disponible),
    ...conDisponibilidad.filter(v => !v.disponible),
  ]
}
