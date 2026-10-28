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

/** Una línea con el antes/después mínimo que guardó el trigger. */
export function resumenDetalle(row) {
  const d = row.detail ?? {}
  if (d.antes !== undefined && d.despues !== undefined && typeof d.antes !== 'object') {
    return `${corto(d.antes)} → ${corto(d.despues)}${d.motivo ? ` · ${corto(d.motivo)}` : ''}`
  }
  if (d.cambios) {
    return Object.entries(d.cambios).map(([k, v]) => `${k}: ${corto(v.antes)} → ${corto(v.despues)}`).join(' · ')
  }
  if (d.columnas) return `Columnas: ${d.columnas.join(', ')}`
  if (d.tipo) return `${d.tipo}${d.motivo ? ` · ${corto(d.motivo)}` : ''}`
  if (d.estado && typeof d.estado === 'string') return d.estado
  if (d.monto !== undefined) return `$${d.monto}${d.motivo ? ` · ${corto(d.motivo)}` : ''}`
  if (d.tasa !== undefined) return `tasa ${d.tasa === null ? 'general' : d.tasa}${d.motivo ? ` · ${corto(d.motivo)}` : ''}`
  if (d.rol) return `rol ${d.rol}`
  return ''
}
