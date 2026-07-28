/**
 * Selección del pool de profesionales para consultas on-demand.
 *
 * Vive acá y no inline en OnDemand.jsx para poder verificarlo sin tener que
 * llegar hasta la pantalla de checkout — que requiere autorizar un pago real.
 */

/** Puede cobrar (MP conectado) y tiene un precio configurado. */
export function isPayable(pro) {
  return Boolean(pro && pro.mpConnected !== false && (pro.priceVideo ?? pro.sessionPrice))
}

/**
 * Rota el pool para que no gane siempre el mismo.
 *
 * Antes el match era `payable[0]`, así que el primero de la lista se llevaba el
 * 100% de las consultas y el resto cero — y si justo ese no estaba disponible,
 * todos los pacientes chocaban con la misma pared. Arrancar en un índice
 * distinto reparte la carga sin necesitar estado en el servidor, y lo que queda
 * detrás del elegido es la cola de failover.
 *
 * `startIndex` se inyecta (en producción, al azar) para que esto sea
 * determinístico y testeable.
 */
export function rotatePool(pool, startIndex) {
  if (!Array.isArray(pool) || pool.length < 2) return pool ?? []
  const i = ((startIndex % pool.length) + pool.length) % pool.length
  return [...pool.slice(i), ...pool.slice(0, i)]
}

/** Pool listo para usar: filtrado por cobrabilidad y rotado. */
export function buildPool(prosRaw, startIndex = Math.floor(Math.random() * (prosRaw?.length || 1))) {
  const payable = (prosRaw ?? []).filter(isPayable)
  return rotatePool(payable, startIndex)
}
