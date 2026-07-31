/**
 * Qué build estás viendo.
 *
 * Lo inyecta Vite (`__BUILD_INFO__`, ver `vite.config.js`) con el commit y la
 * fecha del build. Sirve para contestar sin adivinar la pregunta que apareció
 * varias veces mientras se arreglaban los pagos: si el bug que estoy viendo ya
 * está arreglado, ¿estoy sobre el código nuevo o sobre el que me quedó
 * cacheado? El síntoma de un bundle viejo es idéntico al de un fix que no
 * funcionó, y sin este dato la única forma de distinguirlos era comparar a mano
 * el hash del `index-*.js` contra el que sirve producción.
 */

const CRUDO = typeof __BUILD_INFO__ !== 'undefined'
  ? __BUILD_INFO__
  : { commit: 'dev', fecha: null }

export const BUILD_COMMIT = CRUDO.commit

/** "31/07 15:42" en hora de Buenos Aires, o null si no hay fecha. */
export const BUILD_FECHA = CRUDO.fecha
  ? new Date(CRUDO.fecha).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Argentina/Buenos_Aires',
    })
  : null

/** Una línea lista para mostrar: "v e40956d · 31/07 15:42". */
export const BUILD_ETIQUETA = BUILD_FECHA
  ? `v ${BUILD_COMMIT} · ${BUILD_FECHA}`
  : `v ${BUILD_COMMIT}`
