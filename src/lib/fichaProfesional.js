/**
 * Qué se manda de verdad al guardar la ficha de un profesional.
 *
 * Varias pantallas (Configuración, Perfil) leen la ficha ENTERA al abrirse y la
 * devuelven con `{ ...profData, campoQueEditó }`. Esa copia queda rancia en
 * cuanto otra pestaña, otro dispositivo o el servidor cambia algo, y el guardado
 * pisa lo nuevo con lo viejo. Con la presencia on-demand eso es grave: guardar
 * los datos de cobro con la ficha de hace una hora apagaba (o prendía) el switch
 * de consulta inmediata sin que nadie lo tocara.
 *
 * Por eso hay columnas que NO son de ninguna pantalla de edición y que el
 * guardado de la ficha nunca manda:
 *   · la presencia (`on_demand_since`, `on_demand_last_seen_at`): la escriben
 *     sólo el latido (`professional_online_ping`), `professional_offline` y el
 *     trigger de la migración 190. Nunca el cliente.
 *   · `is_on_demand`: sólo viaja si quien llama lo declara a propósito
 *     (`{ presencia: true }`) — el switch del panel y el formulario de Agenda.
 *   · lo que escribe el servidor por su cuenta (Mercado Pago, reseñas, aviso).
 */

/** Columnas (en camelCase) que ningún guardado de la ficha manda jamás. */
export const COLUMNAS_DEL_SERVIDOR = [
  'profiles',              // join de sólo lectura de getByUserId
  'onDemandSince',
  'onDemandLastSeenAt',
  'onDemandAvisoAt',
  'mpConnected',
  'mpAccountLabel',
  'averageRating',
  'totalReviews',
  'createdAt',
  'updatedAt',
]

/**
 * @param {object} datos — lo que pasó el llamador (puede ser la ficha entera).
 * @param {{ presencia?: boolean }} opciones — `presencia: true` deja pasar `isOnDemand`.
 * @returns {object} copia sin las columnas que no le corresponde mandar.
 */
export function armarFichaParaGuardar(datos, { presencia = false } = {}) {
  const limpio = { ...datos }
  for (const k of COLUMNAS_DEL_SERVIDOR) delete limpio[k]
  if (!presencia) delete limpio.isOnDemand
  return limpio
}
