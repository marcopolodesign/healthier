import { useCallback, useEffect, useState } from 'react'
import { professionalService } from '../services/professionalService'
import { miPerfilCache as cache, actualizarMiPerfil, alCambiarMiPerfil } from '../lib/miEspecialidadCache'

/**
 * El `professional_profiles` del profesional logueado, leído una vez y
 * compartido entre pantallas (caché a nivel módulo por usuario). Es la ÚNICA
 * fuente de la especialidad (herramientas de su vertical, migración 200) y de
 * la matrícula con la que se firma la historia clínica — la usan la
 * videollamada y /profesional/historia-clinica. El `profile` que pasa App.jsx
 * no trae `professional_profiles`.
 *
 * Sólo se cachea un perfil real: un error o un perfil que todavía no existe no
 * queda guardado. `professionalService.upsert` deja el perfil nuevo en el
 * caché (ej. el onboarding que cambia de área). `recargar()` lo vuelve a leer
 * (ej. después de cargar la matrícula desde el recetario).
 */
export function useMiPerfilProfesional(userId) {
  const [perfil, setPerfil] = useState(() => (userId ? cache.get(userId) ?? null : null))
  const [cargando, setCargando] = useState(() => !!userId && !cache.has(userId))

  const leer = useCallback(() => {
    if (!userId) { setCargando(false); return Promise.resolve(null) }
    setCargando(true)
    return professionalService.getByUserId(userId)
      .then(p => { actualizarMiPerfil(userId, p ?? null); setPerfil(p ?? null); return p ?? null })
      .catch(() => null)
      .finally(() => setCargando(false))
  }, [userId])

  useEffect(() => alCambiarMiPerfil(id => {
    if (id === userId) setPerfil(cache.get(userId) ?? null)
  }), [userId])

  useEffect(() => {
    if (!userId) { setCargando(false); return }
    if (cache.has(userId)) { setPerfil(cache.get(userId)); setCargando(false); return }
    leer()
  }, [userId, leer])

  return { perfil, cargando, recargar: leer }
}

/** La especialidad (slug) del profesional logueado, o `null` mientras carga. */
export function useMiEspecialidad(userId) {
  return useMiPerfilProfesional(userId).perfil?.specialty ?? null
}
