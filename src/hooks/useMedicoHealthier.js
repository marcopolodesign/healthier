import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Una consulta por sesión, compartida por el menú, la barra de abajo y el inicio.
const cache = new Map()

/**
 * ¿El profesional logueado es "médico de Healthier"? (atiende los pedidos de
 * receta de la farmacia, migración 254). Es sólo para mostrar la entrada del
 * menú: lo que puede hacer lo decide la base (`es_medico_healthier`).
 */
export function useMedicoHealthier(profile) {
  const userId = profile?.role === 'professional' ? profile.id : null
  const [es, setEs] = useState(() => (userId && cache.get(userId)?.valor) ?? false)

  useEffect(() => {
    if (!userId) { setEs(false); return }
    let vivo = true
    if (!cache.has(userId)) {
      const promesa = supabase.from('professional_profiles').select('medico_healthier')
        .eq('user_id', userId).maybeSingle()
        .then(({ data }) => { const valor = Boolean(data?.medico_healthier); cache.set(userId, { valor, promesa }); return valor })
        .catch(() => false)
      cache.set(userId, { valor: false, promesa })
    }
    cache.get(userId).promesa.then(v => { if (vivo) setEs(v) })
    return () => { vivo = false }
  }, [userId])

  return es
}
