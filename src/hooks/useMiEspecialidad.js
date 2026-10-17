import { useCallback, useEffect, useState } from 'react'
import { professionalService } from '../services/professionalService'

/**
 * El `professional_profiles` del profesional logueado: la especialidad (para
 * las herramientas de su vertical, migración 200) y la matrícula con la que se
 * firma la historia clínica. El `profile` que pasa App.jsx no trae
 * `professional_profiles`.
 *
 * Se lee al montar la pantalla; si dos pantallas lo piden a la vez, comparten
 * la misma lectura. Sin caché entre pantallas a propósito: los profesionales
 * se verifican a mano y sólo atiende quien tiene matrícula, así que no hace
 * falta más (decisión de Mateo, 2026-10-17). Si la lectura falla queda en
 * `error`, para mostrar el mensaje real al intentar firmar.
 */
const enVuelo = new Map()

function leer(userId, { nueva = false } = {}) {
  // `nueva`: no reusar una lectura que arrancó antes (ej. recién se cargó la
  // matrícula desde el recetario y hay que verla).
  if (nueva || !enVuelo.has(userId)) {
    enVuelo.set(userId, professionalService.getByUserId(userId, { tirarError: true }).finally(() => enVuelo.delete(userId)))
  }
  return enVuelo.get(userId)
}

export function useMiPerfilProfesional(userId) {
  const [perfil, setPerfil] = useState(null)
  const [cargando, setCargando] = useState(!!userId)
  const [error, setError] = useState(null)

  const cargar = useCallback(async ({ nueva = false } = {}) => {
    if (!userId) return null
    setCargando(true)
    try {
      const p = await leer(userId, { nueva })
      setPerfil(p)
      setError(null)
      return p
    } catch (err) {
      setError(err)
      throw err
    } finally {
      setCargando(false)
    }
  }, [userId])

  // El userId puede llegar después del primer render: `cargar` pone
  // `cargando` en true recién cuando de verdad empieza a leer.
  useEffect(() => {
    if (!userId) { setCargando(false); return }
    cargar().catch(() => {})
  }, [userId, cargar])

  const recargar = useCallback(() => cargar({ nueva: true }), [cargar])

  return { perfil, cargando, error, recargar }
}

/** La especialidad (slug) del profesional logueado, o `null` mientras carga. */
export function useMiEspecialidad(userId) {
  return useMiPerfilProfesional(userId).perfil?.specialty ?? null
}
