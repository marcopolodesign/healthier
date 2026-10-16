import { useState, useEffect, useMemo } from 'react'
import { VERTICALS, iconoDe, conAlfa } from '../lib/verticals'
import { verticalsService } from '../services/verticalsService'

/**
 * Las verticales con su configuración real. Desde la migración 199 la lista,
 * el nombre, el color de fondo, el ícono y la foto salen de la base
 * (`vertical_settings`, creables desde /super-admin/verticales); el código sólo
 * aporta fallback y el color de marca de las siete de siempre.
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

// Color de fondo del carrusel cuando la base todavía no respondió: los mismos
// del spec 2026-09-23 que antes vivían en OnDemandCarousel.jsx.
const FONDO_FALLBACK = { clinica: '#7CB38B', pediatria: '#D9699C', mente: '#9B8EC4', nutricion: '#E8927C' }

function mezclar(config) {
  if (!config) {
    // Sin config: los valores del código, con `enabled` derivado del viejo
    // `comingSoon` para que el resto de la app hable un solo idioma.
    return VERTICALS.map(v => ({
      ...v, enabled: !v.comingSoon, onDemandPrice: null, fondo: FONDO_FALLBACK[v.id] ?? '#7CB38B',
    }))
  }
  // Desde la migración 199 la LISTA sale de la base (se pueden crear verticales
  // desde el super admin). El código sólo aporta, para las siete de siempre, el
  // `color`/`bg`/`shadow` de marca que pintan el mapa y las etiquetas.
  const codigo = Object.fromEntries(VERTICALS.map(v => [v.id, v]))
  return config
    .filter(c => (c.tipo ?? 'vertical') === 'vertical')
    .map(c => {
      const base = codigo[c.id]
      const fondo = c.color || FONDO_FALLBACK[c.id] || base?.color || '#7CB38B'
      return {
        id: c.id,
        nombre: c.nombre || base?.nombre || c.id,
        icon: c.icon ? iconoDe(c.icon) : (base?.icon ?? iconoDe(null)),
        iconKey: c.icon ?? null,
        color: base?.color ?? fondo,
        bg: base?.bg ?? conAlfa(fondo, 0.1),
        shadow: base?.shadow ?? conAlfa(fondo, 0.15),
        // La foto que se sube desde el panel manda; si no hay, la del código.
        img: c.imageUrl || base?.img || null,
        imageUrl: c.imageUrl ?? null,
        fondo,
        enabled: c.enabled,
        comingSoon: !c.enabled,
        onDemandPrice: c.ondemandPrice ?? null,
        sortOrder: c.sortOrder ?? 999,
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
