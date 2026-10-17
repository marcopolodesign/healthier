import { useEffect, useState } from 'react'
import { professionalService } from '../services/professionalService'
import { miEspecialidadCache as cache, alInvalidarMiEspecialidad } from '../lib/miEspecialidadCache'

/**
 * La especialidad (slug) del profesional logueado, para decidir qué
 * herramientas de su vertical ve (migración 200: historia clínica, receta).
 *
 * El `profile` que pasa App.jsx no trae `professional_profiles`, así que se lee
 * una vez y se comparte entre pantallas (caché a nivel módulo por usuario).
 * Sólo se cachea un slug real: un error o un perfil que todavía no existe no
 * queda guardado, y `professionalService.upsert` invalida el caché (ej. el
 * onboarding que cambia de área). `null` mientras carga: los que lo usan
 * muestran la herramienta en ese instante (no le cortan la HC a nadie por un
 * fetch lento).
 */
export function useMiEspecialidad(userId) {
  const [slug, setSlug] = useState(() => (userId ? cache.get(userId) ?? null : null))
  const [version, setVersion] = useState(0)

  useEffect(() => alInvalidarMiEspecialidad(id => { if (!id || id === userId) setVersion(v => v + 1) }), [userId])

  useEffect(() => {
    if (!userId) return
    if (cache.has(userId)) { setSlug(cache.get(userId)); return }
    let vivo = true
    professionalService.getByUserId(userId)
      .then(p => {
        const s = p?.specialty ?? null
        if (s) cache.set(userId, s)
        if (vivo) setSlug(s)
      })
      .catch(() => {})
    return () => { vivo = false }
  }, [userId, version])

  return slug
}
