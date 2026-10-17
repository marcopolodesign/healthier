import { useCallback, useEffect, useState } from 'react'
import { professionalService } from '../services/professionalService'
import { miPerfilCache as cache, actualizarMiPerfil, alCambiarMiPerfil } from '../lib/miEspecialidadCache'

/**
 * El `professional_profiles` del profesional logueado. Es la ÚNICA fuente de
 * la especialidad (herramientas de su vertical, migración 200) y de la
 * matrícula con la que se firma la historia clínica — la usan la videollamada
 * y /profesional/historia-clinica. (El `profile` que pasa App.jsx no trae
 * `professional_profiles`.)
 *
 * - **Stale-while-revalidate:** si hay algo en caché se muestra al toque, pero
 *   cada pantalla que monta el hook lo vuelve a leer — un cambio hecho por el
 *   super admin o desde otro dispositivo se ve sin cerrar sesión.
 * - **Una sola lectura en vuelo** por usuario (mismo patrón `inflight` que
 *   useEspecialidades/useVerticales): dos pantallas a la vez no duplican.
 * - **Error ≠ sin perfil:** un corte de red queda en `error` (y `recargar()`
 *   lo tira), en vez de parecer "no tiene matrícula".
 * - `professionalService.upsert` deja en el caché lo recién guardado.
 */
const inflight = new Map()

function leerPerfil(userId) {
  if (!inflight.has(userId)) {
    const p = professionalService.getMiPerfil(userId)
      .then(perfil => { actualizarMiPerfil(userId, perfil); return perfil })
      .finally(() => inflight.delete(userId))
    inflight.set(userId, p)
  }
  return inflight.get(userId)
}

export function useMiPerfilProfesional(userId) {
  const [perfil, setPerfil] = useState(() => (userId ? cache.get(userId) ?? null : null))
  const [cargando, setCargando] = useState(() => !!userId && !cache.has(userId))
  const [error, setError] = useState(null)

  useEffect(() => alCambiarMiPerfil(id => {
    if (id === userId) setPerfil(cache.get(userId) ?? null)
  }), [userId])

  /** Vuelve a leer. Devuelve el perfil (o `null` si no tiene ficha); ante un error de red, TIRA. */
  const recargar = useCallback(async () => {
    if (!userId) return null
    try {
      const p = await leerPerfil(userId)
      setError(null)
      setPerfil(p)
      return p
    } catch (err) {
      setError(err)
      throw err
    } finally {
      setCargando(false)
    }
  }, [userId])

  useEffect(() => {
    if (!userId) { setCargando(false); return }
    if (cache.has(userId)) setPerfil(cache.get(userId))
    recargar().catch(() => { /* queda en `error`; el que firma reintenta */ })
  }, [userId, recargar])

  return { perfil, cargando, error, recargar }
}

/** La especialidad (slug) del profesional logueado, o `null` mientras carga. */
export function useMiEspecialidad(userId) {
  return useMiPerfilProfesional(userId).perfil?.specialty ?? null
}
