import { useEffect, useState } from 'react'
import { professionalService } from '../services/professionalService'

// Una consulta por sesión (promesa compartida), para el menú, la barra de abajo
// y el inicio. Un error no se guarda: el próximo montaje vuelve a preguntar.
const cache = new Map()

function consultar(userId) {
  if (!cache.has(userId)) {
    cache.set(userId, professionalService.esMedicoHealthier(userId)
      .catch(() => { cache.delete(userId); return false }))
  }
  return cache.get(userId)
}

/**
 * ¿El profesional logueado es "médico de Healthier"? (atiende los pedidos de
 * receta de la farmacia, migración 254). Es sólo para mostrar la entrada del
 * menú: lo que puede hacer lo decide la base (`es_medico_healthier`).
 */
export function useMedicoHealthier(profile) {
  const userId = profile?.role === 'professional' ? profile.id : null
  const [es, setEs] = useState(false)

  useEffect(() => {
    if (!userId) { setEs(false); return }
    let vivo = true
    consultar(userId).then(v => { if (vivo) setEs(v) })
    return () => { vivo = false }
  }, [userId])

  return es
}
