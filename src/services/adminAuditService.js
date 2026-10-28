import { supabase } from '../lib/supabase'

/**
 * Registro de acciones de administradores (migración 218). Sólo lectura: la
 * tabla es append-only y la escriben triggers de la base — acá no hay
 * insert/update/delete a propósito. Sólo el super admin puede leerla (RLS).
 */
export const adminAuditService = {
  async list({ limit = 200 } = {}) {
    const { data, error } = await supabase
      .from('admin_action_log')
      .select('id, created_at, actor_id, actor_role, actor_email, actor_name, via, action, entity_type, entity_id, target_user_id, target_label, detail')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message || 'No se pudo cargar el registro de acciones')
    return data ?? []
  },
}

export const ACCIONES_ADMIN = {
  alta_de_cuenta:                  'Alta de cuenta',
  cambio_de_rol:                   'Cambio de rol',
  baja_de_cuenta:                  'Baja de cuenta',
  reactivacion_de_cuenta:          'Reactivación de cuenta',
  eliminacion_de_perfil:           'Perfil eliminado',
  edicion_de_perfil_por_admin:     'Perfil editado por un admin',
  cambio_de_exencion_o_titular:    'Cambio de exención o titular',
  cambio_de_marca_de_prueba:       'Cambio de cuenta de prueba',
  verificacion_profesional:        'Verificación de profesional',
  rechazo_profesional:             'Rechazo / revisión de profesional',
  cambio_de_estado_de_profesional: 'Profesional activado / desactivado',
  decision_consultorio:            'Decisión sobre el consultorio',
  iniciar_sesion_como:             'Inició sesión como otra persona',
  devolucion_aprobada:             'Devolución aprobada',
  devolucion_rechazada:            'Devolución rechazada',
  devolucion_forzada:              'Devolución forzada',
  conversion_de_credito_a_mp:      'Crédito convertido a Mercado Pago',
  cambio_de_comision:              'Cambio de comisión',
}

/** Nombre legible de una acción; las de configuración (`alta_zones`…) se arman solas. */
export function etiquetaAccion(action) {
  if (ACCIONES_ADMIN[action]) return ACCIONES_ADMIN[action]
  const m = /^(alta|modificacion|eliminacion)_(.+)$/.exec(action ?? '')
  if (!m) return action
  const verbo = { alta: 'Alta en', modificacion: 'Cambio en', eliminacion: 'Borrado en' }[m[1]]
  return `${verbo} ${m[2].replaceAll('_', ' ')}`
}

const corto = (v) => {
  const t = v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return t.length > 60 ? `${t.slice(0, 60)}…` : t
}

const esPar = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && 'antes' in v && 'despues' in v
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const cambio = (v) => JSON.stringify(v.antes) !== JSON.stringify(v.despues)
const par = (k, v) => `${k ? `${k}: ` : ''}${corto(v.antes)} → ${corto(v.despues)}`
const pares = (o) => Object.entries(o).slice(0, 4).map(([k, v]) => `${k}=${corto(v)}`).join(', ')

/**
 * Una línea con el antes/después mínimo que guardó el trigger. Entiende todas
 * las formas de `detail` de la migración 218:
 *   · {antes, despues[, motivo, fuente]}            → "a → b · motivo"
 *   · {campo: {antes, despues}, …}                  → "campo: a → b · …"
 *   · {cambios|estado: {campo: {antes, despues}}}   → ídem
 *   · {antes: {…}} / {despues: {…}}                 → "Anterior: k=v, …" / "Nuevo: k=v, …"
 *   · {columnas: [...]}                             → "Columnas: a, b"
 *   · {monto, tipo, motivo} · {tasa, …} · {rol}     → "$1000 · tipo · motivo"
 */
export function resumenDetalle(row) {
  const d = row.detail ?? {}
  const partes = []

  if (d.monto !== undefined && d.monto !== null) partes.push(`$${d.monto}`)

  // antes → después de un solo valor (también cuando antes es null: alta)
  if ('antes' in d && 'despues' in d && !esObjeto(d.antes) && !esObjeto(d.despues)) {
    if (cambio(d) || d.antes === null) partes.push(par('', d))   // verificación en INSERT: "— → true"
  }
  else if (esObjeto(d.despues) && !('antes' in d)) partes.push(`Nuevo: ${pares(d.despues)}`)
  else if (esObjeto(d.antes) && !('despues' in d)) partes.push(`Anterior: ${pares(d.antes)}`)

  for (const [k, v] of Object.entries(d)) {
    if (esPar(v)) { if (cambio(v)) partes.push(par(k, v)) }     // un par que no cambió no dice nada
    else if ((k === 'cambios' || k === 'estado') && esObjeto(v)) {
      for (const [campo, pv] of Object.entries(v)) if (esPar(pv) && cambio(pv)) partes.push(par(campo, pv))
    }
  }

  if (Array.isArray(d.columnas)) partes.push(`Columnas: ${d.columnas.join(', ')}`)
  if (typeof d.estado === 'string' && d.estado) partes.push(d.estado)
  if (d.tipo) partes.push(String(d.tipo))
  if (d.tasa !== undefined) partes.push(`tasa ${d.tasa === null ? 'general' : d.tasa}`)
  if (d.vigente_hasta) partes.push(`hasta ${String(d.vigente_hasta).slice(0, 10)}`)
  if (d.rol) partes.push(`rol ${d.rol}`)
  if (d.fuente) partes.push(`fuente ${d.fuente}`)
  if (d.motivo) partes.push(corto(d.motivo))
  if (d.nota) partes.push(corto(d.nota))

  if (partes.length) return partes.join(' · ')
  // Sin datos mínimos: al menos qué tipo de movimiento fue.
  const m = /^(alta|modificacion|eliminacion)_/.exec(row.action ?? '')
  if (m) return { alta: 'Registro nuevo', modificacion: 'Registro modificado', eliminacion: 'Registro eliminado' }[m[1]]
  return ''
}
