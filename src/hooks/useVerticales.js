import { useState, useEffect, useMemo } from 'react'
import { VERTICALS } from '../lib/verticals'
import { verticalsService } from '../services/verticalsService'

/**
 * Las verticales con su configuración real: identidad visual del código +
 * habilitación y precio de la base (migración 078).
 *
 * Por qué un caché a nivel módulo y no un provider: cinco pantallas del paciente
 * leen esto (Dashboard, Consultas, Buscar, Reservar, OnDemand) y ninguna es
 * padre de las otras. Un provider habría obligado a envolver el árbol entero
 * para un dato que cambia una vez cada muchos meses; esto hace un solo fetch y
 * lo comparte, sin tocar el routing.
 *
 * Mientras el fetch está en vuelo se devuelven los valores del código
 * (`comingSoon` tal como estaba hardcodeado). Es el estado que ya era verdad
 * hasta hoy, así que en el peor caso se ve un instante lo de antes en vez de un
 * salto de "todo habilitado" a "todo deshabilitado".
 *
 * Cada vertical devuelta expone además `comingSoon: !enabled`, que es el nombre
 * que ya usa todo el JSX del paciente. Eso evita tocar decenas de condicionales
 * para renombrar un booleano.
 */

let cache = null          // array de config, o null si todavía no llegó
let inflight = null       // promesa en curso, para no disparar N fetches
const listeners = new Set()

function notificar(data) {
  cache = data
  listeners.forEach(fn => fn(data))
}

function cargar() {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = verticalsService.getAll()
      .then(data => { notificar(data); return data })
      .catch(() => {
        // Falla de red: se sigue con los defaults del código. No se cachea el
        // error, así que la próxima pantalla vuelve a intentar.
        notificar(null)
        return null
      })
      .finally(() => { inflight = null })
  }
  return inflight
}

/** Fuerza una relectura — la usa el panel de super admin después de guardar. */
export function invalidarVerticales() {
  cache = null
  return cargar()
}

function mezclar(config) {
  if (!config) {
    // Sin config: los valores del código, con `enabled` derivado del viejo
    // `comingSoon` para que el resto de la app hable un solo idioma.
    return VERTICALS.map(v => ({ ...v, enabled: !v.comingSoon, onDemandPrice: null }))
  }
  const porId = Object.fromEntries(config.map(c => [c.id, c]))
  return VERTICALS
    .map(v => {
      const c = porId[v.id]
      const enabled = c ? c.enabled : !v.comingSoon
      return {
        ...v,
        enabled,
        comingSoon: !enabled,
        onDemandPrice: c?.ondemandPrice ?? null,
        sortOrder: c?.sortOrder ?? 999,
      }
    })
    .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999))
}

export function useVerticales() {
  const [config, setConfig] = useState(cache)

  useEffect(() => {
    listeners.add(setConfig)
    cargar()
    return () => { listeners.delete(setConfig) }
  }, [])

  const verticales = useMemo(() => mezclar(config), [config])
  const verticalesById = useMemo(
    () => Object.fromEntries(verticales.map(v => [v.id, v])),
    [verticales]
  )

  return { verticales, verticalesById, cargando: config === null }
}
