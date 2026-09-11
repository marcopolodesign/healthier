import { useCallback, useEffect, useState } from 'react'
import { firmaService } from '../services/firmaService'

/**
 * Si el profesional tiene cargada su firma para las recetas.
 *
 * Lo usa `PrescriptionCreator` para decidir, al apretar "Emitir receta", si
 * emite o si abre la hoja de firma (`FirmaSheet`). La firma es obligatoria
 * desde el 2026-09-11.
 *
 * ── Qué pasa mientras carga, y por qué ──────────────────────────────────────
 * Devuelve `cargando: true` y `tieneFirma: false`. Ese `false` NO significa
 * "no tiene": mientras carga, el botón de emitir se muestra apagado —es un
 * instante— en vez de abrir la hoja a alguien que sí tiene firma cargada.
 *
 * Ante un error de red devuelve `tieneFirma: true` — o sea, **no bloquea**. La
 * validación de verdad la hace `rcta-issue`, que corta con
 * `RCTA_FIRMA_FALTANTE` y un mensaje accionable; dejar que el front bloquee por
 * un fetch fallido sería inventar un motivo que no sabemos si es cierto.
 */
export function useFirmaDelProfesional(professionalId) {
  const [tieneFirma, setTieneFirma] = useState(false)
  const [cargando, setCargando] = useState(true)

  const recargar = useCallback(() => {
    if (!professionalId) { setCargando(false); return }
    setCargando(true)
    return firmaService.get(professionalId)
      .then(f => setTieneFirma(!!f))
      .catch(() => setTieneFirma(true))
      .finally(() => setCargando(false))
  }, [professionalId])

  useEffect(() => { recargar() }, [recargar])

  /** Para avisar desde el pad, sin ir de nuevo a la base. */
  const marcar = useCallback(hay => setTieneFirma(!!hay), [])

  return { tieneFirma, cargando, recargar, marcar }
}
