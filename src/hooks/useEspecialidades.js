import { useState, useEffect, useMemo } from 'react'
import { especialidadesService } from '../services/especialidadesService'

/**
 * El catálogo de especialidades (migración 101), con la config real de la base.
 *
 * Mismo patrón que `useVerticales`: caché a nivel módulo + listeners, un solo
 * fetch compartido por todas las pantallas que lo usan (tarjetas de
 * profesional, buscador, onboarding, historia clínica, super-admin). Mientras
 * el fetch está en vuelo se devuelve `[]` — no hay fallback hardcodeado en
 * código como en `useVerticales` porque el catálogo YA NO vive en código.
 *
 * `porSlug` es el reemplazo directo del viejo `SPECIALTY_LABELS[slug]`.
 * `porVertical` es el reemplazo directo del viejo `VERTICAL_SPECIALTIES[verticalId]`
 * (array de slugs de esa vertical, sólo especialidades de primer nivel).
 * `activas` son las especialidades de primer nivel, activas, ordenadas — para
 * selects. `subEspecialidadesDe[parentId]` da las sub-especialidades activas de
 * un padre dado (por su `id`, no por slug).
 */

let cache = null
let inflight = null
const listeners = new Set()

function notificar(data) {
  cache = data
  listeners.forEach(fn => fn(data))
}

function cargar() {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = especialidadesService.getAll()
      .then(data => { notificar(data); return data })
      .catch(() => {
        // Falla de red: no se cachea el error, la próxima pantalla reintenta.
        notificar(null)
        return null
      })
      .finally(() => { inflight = null })
  }
  return inflight
}

/** Fuerza una relectura — la usa el panel de super admin después de guardar. */
export function invalidarEspecialidades() {
  cache = null
  return cargar()
}

export function useEspecialidades() {
  const [config, setConfig] = useState(cache)

  useEffect(() => {
    listeners.add(setConfig)
    cargar()
    return () => { listeners.delete(setConfig) }
  }, [])

  const especialidades = useMemo(() => config ?? [], [config])

  const porSlug = useMemo(
    () => Object.fromEntries(especialidades.map(e => [e.slug, e.label])),
    [especialidades]
  )

  const porVertical = useMemo(() => {
    const map = {}
    especialidades.forEach(e => {
      if (!e.verticalId || e.parentId) return
      if (!map[e.verticalId]) map[e.verticalId] = []
      map[e.verticalId].push(e.slug)
    })
    return map
  }, [especialidades])

  const activas = useMemo(
    () => especialidades
      .filter(e => e.active && !e.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder),
    [especialidades]
  )

  // Qué especialidades pueden recetar (migración 116). Es sólo para decidir qué
  // mostrar: el bloqueo real está en el trigger de `clinical_medications` y en
  // `rcta-issue`. Mientras el catálogo no cargó devuelve `false` — es preferible
  // esconder el recetario un instante de más que ofrecérselo a quien no puede.
  // Desde la migración 200 además tiene que tenerla la VERTICAL
  // (`vertical_settings.herramienta_receta`) — mismo criterio que
  // `profesional_puede_recetar()` en la base.
  const puedeRecetar = useMemo(() => {
    const map = {}
    especialidades.forEach(e => { map[e.slug] = !!e.puedeRecetar && e.vertical?.herramientaReceta !== false })
    return slug => !!map[slug]
  }, [especialidades])

  // Si el profesional de esa especialidad ve la historia clínica (herramienta
  // de su vertical, migración 200). Mientras el catálogo no cargó, o si la
  // especialidad no tiene vertical, `true`: esconder la HC por un fetch lento
  // le cortaría la consulta a un clínico.
  const usaHistoriaClinica = useMemo(() => {
    const map = {}
    especialidades.forEach(e => { map[e.slug] = e.vertical?.herramientaHistoriaClinica !== false })
    return slug => map[slug] ?? true
  }, [especialidades])

  const subEspecialidadesDe = useMemo(() => {
    const map = {}
    especialidades.forEach(e => {
      if (!e.parentId) return
      if (!map[e.parentId]) map[e.parentId] = []
      map[e.parentId].push(e)
    })
    Object.values(map).forEach(list => list.sort((a, b) => a.sortOrder - b.sortOrder))
    return map
  }, [especialidades])

  // Nombre de cada vertical (de la base, migración 199) — para textos como el
  // destino de una derivación, que antes salían de la lista fija del código y
  // con una vertical nueva mostraban el id crudo.
  const nombreVertical = useMemo(() => {
    const map = {}
    especialidades.forEach(e => { if (e.verticalId && e.vertical?.nombre) map[e.verticalId] = e.vertical.nombre })
    return map
  }, [especialidades])

  return {
    especialidades,
    nombreVertical,
    porSlug,
    porVertical,
    activas,
    puedeRecetar,
    usaHistoriaClinica,
    subEspecialidadesDe,
    cargando: config === null,
    invalidar: invalidarEspecialidades,
  }
}
