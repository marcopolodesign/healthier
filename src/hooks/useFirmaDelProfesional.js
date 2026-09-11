import { useCallback, useEffect, useState } from 'react'
import { firmaService } from '../services/firmaService'

/**
 * Si el profesional tiene cargada su firma para las recetas.
 *
 * Vive en un hook y no adentro de `FirmaFaltante` porque lo necesitan dos
 * componentes a la vez: el aviso —que ofrece firmar ahí mismo— y
 * `PrescriptionCreator`, que **bloquea el botón de emitir** mientras no haya
 * firma (Mateo la hizo obligatoria el 2026-09-11). Si cada uno consultara por
 * su lado, el aviso podría decir "listo" con el botón todavía apagado.
 *
 * ── Qué pasa mientras carga, y por qué ──────────────────────────────────────
 * Devuelve `cargando: true` y `tieneFirma: false`. Quien bloquea tiene que
 * mirar `cargando` y NO tratar ese `false` como "no tiene": el botón se muestra
 * deshabilitado un instante, que es preferible a habilitarlo y que la emisión
 * rebote del lado del servidor con el paciente esperando.
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
