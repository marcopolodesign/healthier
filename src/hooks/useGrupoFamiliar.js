import { useEffect, useState } from 'react'
import { familyService } from '../services/familyService'

/**
 * Los familiares que administra el paciente logueado (migración 181). Para el
 * selector "¿Para quién es la consulta?" y la tarjeta de cada familiar.
 * Si falla la lectura devuelve lista vacía: el selector simplemente no aparece
 * y la consulta sale a nombre del titular, que es lo de siempre.
 */
export function useGrupoFamiliar(profileId) {
  const [familiares, setFamiliares] = useState([])
  const [cargando, setCargando] = useState(Boolean(profileId))

  useEffect(() => {
    if (!profileId) return
    let vivo = true
    setCargando(true)
    familyService.listForPatient(profileId)
      .then(rows => { if (vivo) setFamiliares(rows.filter(r => r.familiarId && r.puedeGestionar !== false)) })
      .catch(() => { if (vivo) setFamiliares([]) })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [profileId])

  return { familiares, cargando }
}

/** "Juan Pérez" → "Juan": en el selector alcanza con el nombre de pila. */
export const nombreDePila = (full) => (full || '').trim().split(/\s+/)[0] || 'Familiar'
