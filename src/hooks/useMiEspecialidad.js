import { useCallback, useEffect, useRef, useState } from 'react'
import { professionalService } from '../services/professionalService'

/**
 * El `professional_profiles` del profesional logueado, para lo que MUESTRA la
 * pantalla: la especialidad (herramientas de su vertical, migración 200), si le
 * faltan matrícula o domicilio para emitir. La firma de la HC no sale de acá:
 * la resuelve clinicalService con la sesión al escribir. El `profile` que pasa
 * App.jsx no trae `professional_profiles`.
 *
 * Se lee al montar; si dos pantallas lo piden a la vez, comparten la lectura.
 * `recargar()` hace una lectura nueva (ej. recién se completaron datos desde el
 * recetario) sin volver a "cargando" si ya había perfil — si no, la videollamada
 * escondía la pestaña Receta y volvía a pedir la historia.
 */
const enVuelo = new Map()

function leer(userId, { nueva = false } = {}) {
  if (nueva || !enVuelo.has(userId)) {
    const promesa = professionalService.getByUserId(userId, { tirarError: true })
      // Sólo se borra si sigue siendo ESTA lectura: una vieja no borra la nueva.
      .finally(() => { if (enVuelo.get(userId) === promesa) enVuelo.delete(userId) })
    enVuelo.set(userId, promesa)
  }
  return enVuelo.get(userId)
}

export function useMiPerfilProfesional(userId) {
  const [perfil, setPerfil] = useState(null)
  const [cargando, setCargando] = useState(!!userId)
  const [error, setError] = useState(null)
  // Número de la última lectura pedida: una respuesta vieja no pisa una nueva.
  const ultima = useRef(0)
  const hayPerfil = useRef(false)

  const cargar = useCallback(async ({ nueva = false } = {}) => {
    if (!userId) return null
    const n = ++ultima.current
    if (!hayPerfil.current) setCargando(true)
    try {
      const p = await leer(userId, { nueva })
      if (n === ultima.current) { setPerfil(p); setError(null); hayPerfil.current = !!p }
      return p
    } catch (err) {
      if (n === ultima.current) setError(err)
      throw err
    } finally {
      if (n === ultima.current) setCargando(false)
    }
  }, [userId])

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
