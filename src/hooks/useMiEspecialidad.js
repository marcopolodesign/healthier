import { useEffect, useState } from 'react'
import { professionalService } from '../services/professionalService'

/**
 * La especialidad (slug) del profesional logueado, para decidir qué
 * herramientas de su vertical ve (migración 200: historia clínica, receta).
 *
 * El `profile` que pasa App.jsx no trae `professional_profiles`, así que se lee
 * una vez y se comparte entre pantallas (caché a nivel módulo por usuario).
 * `null` mientras carga: los que lo usan muestran la herramienta en ese
 * instante (no le cortan la HC a nadie por un fetch lento).
 */
const cache = new Map()

export function useMiEspecialidad(userId) {
  const [slug, setSlug] = useState(() => (userId ? cache.get(userId) ?? null : null))
  useEffect(() => {
    if (!userId) return
    if (cache.has(userId)) { setSlug(cache.get(userId)); return }
    let vivo = true
    professionalService.getByUserId(userId)
      .then(p => { const s = p?.specialty ?? null; cache.set(userId, s); if (vivo) setSlug(s) })
      .catch(() => {})
    return () => { vivo = false }
  }, [userId])
  return slug
}
