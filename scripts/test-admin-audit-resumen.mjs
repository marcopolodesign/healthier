/**
 * El detalle del registro de acciones admin (solapa "Acciones de administradores")
 * tiene que decir algo útil para CADA forma de `detail` que escriben los triggers
 * de la migración 218. Un "—" donde hubo un cambio real es un registro que nadie
 * puede leer en una auditoría.
 *
 *   npm run test:resumen-auditoria   (node --test scripts/test-admin-audit-resumen.mjs)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// El servicio importa supabase-js (que necesita import.meta.env): se prueban sólo las funciones puras.
const origen = readFileSync(new URL('../src/services/adminAuditService.js', import.meta.url), 'utf8')
const puro = origen.replace(/^import .*$/m, '').replace(/export const adminAuditService = \{[\s\S]*?\n\}\n/, '')
const { resumenDetalle, etiquetaAccion } = await import(`data:text/javascript,${encodeURIComponent(puro)}`)

const r = (action, detail) => resumenDetalle({ action, detail })

test('cambios de un solo valor, incluida la verificación en INSERT (antes = null)', () => {
  assert.equal(r('cambio_de_rol', { antes: 'patient', despues: 'admin' }), 'patient → admin')
  assert.equal(r('verificacion_profesional', { antes: null, despues: true, fuente: 'manual' }), '— → true · fuente manual')
  assert.equal(r('cambio_de_estado_de_profesional', { antes: true, despues: false }), 'true → false')
})

test('devoluciones muestran el monto', () => {
  const t = r('devolucion_aprobada', { monto: 18000, tipo: 'credit', motivo: 'cancelación' })
  assert.match(t, /^\$18000/)
  assert.match(t, /credit/)
  assert.match(t, /cancelación/)
})

test('cambios anidados {campo:{antes,despues}} no quedan en blanco', () => {
  const t = r('cambio_de_exencion_o_titular', { payment_exempt: { antes: false, despues: true }, titular_id: { antes: null, despues: null } })
  assert.match(t, /payment_exempt: false → true/)
  const c = r('modificacion_platform_settings', { cambios: { slot_duration_minutes: { antes: 20, despues: 15 } } })
  assert.equal(c, 'slot_duration_minutes: 20 → 15')
  const k = r('modificacion_consultations', { columnas: ['status'], estado: { status: { antes: 'a', despues: 'b' } } })
  assert.match(k, /Columnas: status/)
  assert.match(k, /status: a → b/)
})

test('un par que no cambió no se muestra', () => {
  assert.equal(r('cambio_de_exencion_o_titular', { payment_exempt: { antes: false, despues: true }, titular_id: { antes: null, despues: null } }),
    'payment_exempt: false → true')
  assert.equal(r('cambio_de_marca_de_prueba', { es_prueba: { antes: true, despues: true }, ve_ambos_mundos: { antes: false, despues: true } }),
    've_ambos_mundos: false → true')
  assert.equal(r('modificacion_consultations', { columnas: ['status'], estado: { status: { antes: 'a', despues: 'a' } } }), 'Columnas: status')
})

test('altas y bajas de configuración dicen qué había', () => {
  assert.match(r('alta_zones', { despues: { name: 'Palermo', active: true } }), /^Nuevo: name=Palermo, active=true/)
  assert.match(r('eliminacion_zones', { antes: { name: 'Palermo' } }), /^Anterior: name=Palermo/)
  assert.equal(r('eliminacion_payments', {}), 'Registro eliminado')
  assert.equal(r('alta_zones', {}), 'Registro nuevo')
})

test('el resto de las formas', () => {
  assert.equal(r('edicion_de_perfil_por_admin', { columnas: ['full_name', 'phone'] }), 'Columnas: full_name, phone')
  assert.match(r('rechazo_profesional', { tipo: 'revision', motivo: 'falta el título' }), /revision · falta el título/)
  assert.match(r('cambio_de_comision', { tasa: 0.05, vigente_hasta: '2027-01-01T00:00:00Z', motivo: 'convenio' }), /tasa 0.05 · hasta 2027-01-01 · convenio/)
  assert.match(r('cambio_de_comision', { tasa: null, vigente_hasta: null, motivo: 'vuelve a la general' }), /tasa general/)
  assert.match(r('decision_consultorio', { estado: 'aprobado_manual', nota: null }), /aprobado_manual/)
  assert.equal(r('baja_de_cuenta', { rol: 'patient' }), 'rol patient')
  assert.equal(etiquetaAccion('baja_de_cuenta'), 'Baja de cuenta')
  assert.equal(etiquetaAccion('modificacion_pharmacies'), 'Cambio en pharmacies')
})

test("el cambio de contraseña propia se lee entero: etiqueta y nota, sin valores", () => {
  assert.equal(etiquetaAccion("cambio_de_contrasena"), "Cambio de contraseña propia")
  assert.equal(r("cambio_de_contrasena", { nota: "Puso su contraseña por primera vez" }), "Puso su contraseña por primera vez")
  assert.equal(r("cambio_de_contrasena", { nota: "Cambió su contraseña" }), "Cambió su contraseña")
})
