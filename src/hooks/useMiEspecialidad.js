import { useCallback, useEffect, useState } from 'react'
import { professionalService } from '../services/professionalService'
import {
  miPerfilCache as cache, versionDe, leidoMiPerfil, marcarLectura, alCambiarMiPerfil,
} from '../lib/miEspecialidadCache'

/**
 * El `professional_profiles` del profesional logueado. ÚNICA fuente de la
 * especialidad (herramientas de su vertical, migración 200) y de la matrícula
 * con la que se firma la historia clínica (videollamada, historia clínica,
 * detalle de consulta, atención de emergencia). El `profile` de App.jsx no
 * trae `professional_profiles`.
 *
 * - Stale-while-revalidate: muestra lo cacheado y relee al montar.
 * - Una sola lectura en vuelo por usuario.
 * - Una lectura que arrancó antes de un `upsert` no pisa lo recién guardado
 *   (versión en `lib/miEspecialidadCache`).
 * - Error ≠ sin perfil: el estado de la lectura queda registrado y
 *   `clinicalService` lo usa para decir "no pudimos leer tu perfil" en vez de
 *   "falta tu matrícula".
 */
const inflight = new Map()

function leerPerfil(userId) {
  if (!inflight.has(userId)) {
    const v = versionDe(userId)
    marcarLectura(userId, { cargando: true })
    const p = professionalService.getByUserId(userId, { tirarError: true })
      .then(perfil => { leidoMiPerfil(userId, perfil, v); return cache.get(userId) ?? perfil ?? null })
      .catch(err => { marcarLectura(userId, { cargando: false, error: err }); throw err })
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

  /** Relee. Devuelve el perfil (`null` si no tiene ficha); ante un error de red, TIRA. */
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
    recargar().catch(() => { /* queda registrado; clinicalService lo dice al firmar */ })
  }, [userId, recargar])

  return { perfil, cargando, error, recargar }
}

/** La especialidad (slug) del profesional logueado, o `null` mientras carga. */
export function useMiEspecialidad(userId) {
  return useMiPerfilProfesional(userId).perfil?.specialty ?? null
}
