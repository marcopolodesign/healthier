/**
 * Cuentas de prueba fuera de las métricas y del panel (Mateo, 2026-11-03).
 *
 * La marca es `profiles.es_prueba` (migración 186). Desde la 229 cada tabla que
 * el super admin cuenta o lista (consultas, pagos, profesionales, emergencias,
 * pedidos, mails, …) tiene un campo calculado `es_prueba` que PostgREST expone
 * como una columna: es de prueba si su paciente o su profesional lo es.
 *
 * Por defecto todo lo del super admin sale SIN cuentas de prueba. El control
 * "Incluir cuentas de prueba" (`IncluirPruebaToggle`, hook `useIncluirPrueba`)
 * las vuelve a mostrar para revisar el detalle.
 *
 * Usar siempre estos helpers en vez de repetir el filtro a mano.
 */

/**
 * Agrega el filtro a un query builder de supabase-js.
 * @param query  query de `supabase.from(<tabla con es_prueba>)`
 * @param {boolean} incluir  true = no filtra (se ven también las de prueba)
 */
export function sinPrueba(query, incluir = false) {
  return incluir ? query : query.eq('es_prueba', false)
}

/** Lo mismo sobre filas ya traídas (camelCase o snake_case). */
export function filtrarPrueba(rows, incluir = false) {
  if (incluir) return rows ?? []
  return (rows ?? []).filter((r) => !(r?.esPrueba ?? r?.es_prueba))
}
