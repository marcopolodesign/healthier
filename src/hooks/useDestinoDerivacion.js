import { useCallback } from 'react'
import { useEspecialidades } from './useEspecialidades'
import { useVerticales } from './useVerticales'
import { destinoLabel, verticalDeDerivacion } from '../services/derivacionesService'

/**
 * El texto del destino de una derivación ("Psiquiatría", "Clínica · Cardiología"
 * o el nombre del profesional), con la vertical resuelta AL LEER desde la
 * especialidad destino — no la `vertical_destino` guardada, que queda vieja si
 * la especialidad cambia de vertical (revisión pre-prod, 2026-10-17). El nombre
 * de la vertical sale de `useVerticales` (única fuente).
 */
export function useDestinoDerivacion() {
  const { porSlug, especialidades } = useEspecialidades()
  const { verticalesById } = useVerticales()
  return useCallback(
    d => destinoLabel(d, porSlug, verticalesById, especialidades),
    [porSlug, verticalesById, especialidades]
  )
}

export { verticalDeDerivacion }
