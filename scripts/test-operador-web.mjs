// Control de la pantalla web del operador de emergencias (Medizin). Corre con
// `npm run test:operador-web`. Lo crítico, sin browser ni base:
//   1 · "Terminar turno" descarta la sesión EN EL ACTO: cierra la sesión local y borra lo que
//       supabase-js guardó, aunque la base conteste con error (Supabase no revoca un access
//       token ya emitido; ver migración 243 y src/lib/sesionOperador.js).
//   2 · El operador no ve ganancias, verificación ni Mercado Pago: la pantalla no importa nada
//       de eso ni cierra por `mp-capture`, y la ruta sólo admite crew / profesional en modo operador.
// El recorrido completo, desde el front, es `scripts/verificar-operador-web-front.mjs`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { terminarTurnoYDescartarSesion, descartarSesionLocal } from '../src/lib/sesionOperador.js'

const leer = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')

function storageFalso(inicial) {
  const m = new Map(Object.entries(inicial))
  return {
    get length() { return m.size },
    key: i => [...m.keys()][i] ?? null,
    removeItem: k => m.delete(k),
    getItem: k => m.get(k) ?? null,
    claves: () => [...m.keys()],
  }
}
function clienteFalso({ rpcError = null } = {}) {
  const llamadas = []
  return {
    llamadas,
    rpc: async (nombre) => { llamadas.push(['rpc', nombre]); return { data: null, error: rpcError } },
    auth: { signOut: async (opts) => { llamadas.push(['signOut', opts]); return { error: null } } },
  }
}

test('terminar turno: pide a la base cerrar la sesión y descarta la local en el acto', async () => {
  const supabase = clienteFalso()
  const storage = storageFalso({ 'sb-abc-auth-token': '{"access_token":"x"}', 'operador-ingreso': 'i1', 'otra-cosa': 'queda' })
  const { error } = await terminarTurnoYDescartarSesion({ supabase, storage })
  assert.equal(error, null)
  assert.deepEqual(supabase.llamadas[0], ['rpc', 'terminar_turno_operador'])
  assert.deepEqual(supabase.llamadas[1], ['signOut', { scope: 'local' }])
  assert.deepEqual(storage.claves(), ['otra-cosa'], 'sólo quedan claves ajenas a la sesión')
})

test('terminar turno: si la base falla, la sesión se descarta igual y el error se devuelve', async () => {
  const supabase = clienteFalso({ rpcError: { message: 'boom' } })
  const storage = storageFalso({ 'sb-abc-auth-token': 'x' })
  const { error } = await terminarTurnoYDescartarSesion({ supabase, storage })
  assert.equal(error.message, 'boom')
  assert.deepEqual(storage.claves(), [])
})

test('descartarSesionLocal: aguanta un signOut que revienta y un storage bloqueado', async () => {
  const supabase = { auth: { signOut: async () => { throw new Error('red') } } }
  await descartarSesionLocal({ supabase, storage: { get length() { throw new Error('bloqueado') } } })
})

test('la pantalla llama a terminar turno y sale con recarga completa al login', () => {
  const turno = leer('pages/operador/Turno.jsx')
  assert.match(turno, /operadorService\.terminarTurno\(\)/)
  assert.match(turno, /window\.location\.replace\('\/login'\)/)
  assert.match(leer('services/operadorService.js'), /terminarTurnoYDescartarSesion\(\{ supabase, storage: window\.localStorage \}\)/)
})

test('el operador no ve ganancias, verificación ni Mercado Pago', () => {
  for (const f of ['pages/operador/Operador.jsx', 'pages/operador/Turno.jsx', 'pages/operador/ui.jsx', 'services/operadorService.js']) {
    // Sin comentarios: acá importa el código, no que un comentario explique que no lo toca.
    const s = leer(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(s, /mpService|mp-capture|mp-connect|cerrarEmergenciaSinPago/, `${f}: nada de Mercado Pago`)
    assert.doesNotMatch(s, /ganancias|Ganancias|comisi[oó]n|verificaci[oó]n|isVerified/, `${f}: nada de ganancias ni verificación`)
  }
})

test('la ruta /operador sólo admite crew y profesional (en modo operador), y fuera del AppLayout', () => {
  const app = leer('App.jsx')
  const i = app.indexOf('path="/operador"')
  assert.ok(i > app.indexOf('path="/profesional/emergencias"') && i < app.indexOf('path="/profesional/onboarding"'), 'registrada con las rutas standalone, fuera del AppLayout')
  assert.match(app.slice(i, i + 200), /allowed=\{\['emergency_crew', 'professional'\]\}/)
  assert.match(leer('pages/operador/Operador.jsx'), /estoyEnModoOperador\(\)/, 'un profesional común no se queda en /operador')
  assert.match(leer('lib/roleRedirects.js'), /emergency_crew: '\/operador'/)
})

test('en modo operador, ganancias / configuración / perfil / inicio del profesional mandan de vuelta a /operador', () => {
  const app = leer('App.jsx')
  for (const [ruta, comp] of [['/profesional/ganancias', 'ProfessionalGanancias'], ['/profesional/configuracion', 'ProfessionalConfiguracion'], ['/profesional/perfil', 'ProfessionalProfileEdit'], ['/profesional/dashboard', 'ProfessionalDashboard']]) {
    const i = app.indexOf(`<Route path="${ruta}"`)
    assert.ok(i > 0, ruta)
    assert.match(app.slice(i, i + 260), new RegExp(`<FueraDeModoOperador><${comp} `), `${ruta} detrás de FueraDeModoOperador`)
  }
  assert.match(leer('services/operadorService.js'), /data\?\.activo === true/, 'estoy_en_modo_operador devuelve { activo }, no un booleano')
})
