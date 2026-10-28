// Control de "lo arreglado no vuelve" para el segundo factor del super admin
// (Mateo, 2026-10-28; lo pide el manual de seguridad del convenio con el RENAPER).
// Falla si:
//   1. un super admin con factor TOTP verificado y sesión aal1 deja de caer en el
//      paso "verificar" (los 6 dígitos después de la contraseña);
//   2. a un super admin sin factor se le pide algo con el flag apagado, o con el
//      flag prendido deja de bloquearse hacia /super-admin/seguridad;
//   3. paciente, profesional, farmacia, etc. reciben algún paso de MFA;
//   4. el flag de "obligatorio" arranca prendido;
//   5. el guard sale de App.jsx, deja de envolver las rutas, deja de mostrar la
//      pantalla de código o de llamar a mfaService.verificar;
//   6. un login nuevo de la MISMA cuenta (re-login sin cerrar sesión, SIGNED_IN desde otra
//      pestaña) deja de forzar la re-evaluación y hereda el resultado de la sesión anterior;
//   7. la pantalla /super-admin/seguridad aparece linkeada desde el menú (hoy NO
//      se muestra, decisión de Mateo).
//   npm run test:mfa
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decidirPasoMfa, PASO_MFA, MFA_SUPERADMIN_OBLIGATORIO, RUTA_SEGURIDAD, limpiarCodigo,
  sesionIdDeToken, claveDeEvaluacion, resultadoVigente,
} from '../src/lib/mfa.js'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = ruta => readFileSync(join(RAIZ, ruta), 'utf8')

test('super admin con factor verificado y sesión aal1 → pide los 6 dígitos', () => {
  for (const obligatorio of [false, true]) {
    assert.equal(
      decidirPasoMfa({ role: 'super_admin', currentLevel: 'aal1', tieneFactor: true, obligatorio }),
      PASO_MFA.VERIFICAR,
    )
  }
})

test('super admin con factor y sesión aal2 → entra', () => {
  assert.equal(decidirPasoMfa({ role: 'super_admin', currentLevel: 'aal2', tieneFactor: true }), PASO_MFA.NINGUNO)
})

test('super admin sin factor: entra con el flag apagado, se bloquea con el flag prendido', () => {
  assert.equal(decidirPasoMfa({ role: 'super_admin', currentLevel: 'aal1', tieneFactor: false, obligatorio: false }), PASO_MFA.NINGUNO)
  assert.equal(decidirPasoMfa({ role: 'super_admin', currentLevel: 'aal1', tieneFactor: false, obligatorio: true }), PASO_MFA.ENROLAR)
})

test('otros roles nunca reciben un paso de MFA', () => {
  for (const role of ['patient', 'professional', 'admin', 'pharmacy_admin', 'pharmacy_operator', 'emergency_admin', 'emergency_crew', undefined]) {
    for (const tieneFactor of [false, true]) {
      assert.equal(
        decidirPasoMfa({ role, currentLevel: 'aal1', tieneFactor, obligatorio: true }),
        PASO_MFA.NINGUNO,
        `role=${role} tieneFactor=${tieneFactor}`,
      )
    }
  }
})

test('el flag de obligatorio arranca apagado', () => {
  assert.equal(MFA_SUPERADMIN_OBLIGATORIO, false)
  assert.match(leer('src/lib/mfa.js'), /VITE_MFA_SUPERADMIN_OBLIGATORIO/)
})

test('limpiarCodigo deja sólo hasta 6 dígitos', () => {
  assert.equal(limpiarCodigo('123 456'), '123456')
  assert.equal(limpiarCodigo('12-34-56-78'), '123456')
  assert.equal(limpiarCodigo(null), '')
})

test('App.jsx envuelve las rutas con MfaGuard', () => {
  const app = leer('src/App.jsx')
  assert.match(app, /import MfaGuard from '\.\/components\/auth\/MfaGuard'/)
  const abre = app.indexOf('<MfaGuard profile={profile}>')
  const rutas = app.indexOf('<Routes>')
  const cierraRutas = app.indexOf('</Routes>')
  const cierra = app.indexOf('</MfaGuard>')
  assert.ok(abre > -1 && abre < rutas && cierraRutas < cierra, 'MfaGuard tiene que envolver <Routes>')
})

test('MfaGuard pide el código: decide con decidirPasoMfa, muestra el desafío y verifica contra Supabase', () => {
  const guard = leer('src/components/auth/MfaGuard.jsx')
  assert.match(guard, /decidirPasoMfa\(/)
  assert.match(guard, /actual\.paso === PASO_MFA\.VERIFICAR[\s\S]{0,80}<DesafioMfa/)
  assert.match(guard, /mfaService\.verificar\(/)
  const servicio = leer('src/services/mfaService.js')
  assert.match(servicio, /mfa\.challengeAndVerify\(/)
  assert.match(servicio, /mfa\.getAuthenticatorAssuranceLevel\(/)
})

test('/super-admin/seguridad existe como ruta y NO está linkeada en el menú', () => {
  assert.match(leer('src/App.jsx'), new RegExp(`path="${RUTA_SEGURIDAD}"`))
  assert.doesNotMatch(leer('src/components/Sidebar.jsx'), /super-admin\/seguridad/)
})

test('MfaGuard olvida el resultado al cerrar sesión (re-login sin recargar no hereda el NINGUNO viejo)', () => {
  const guard = leer('src/components/auth/MfaGuard.jsx')
  // el efecto que evalúa tiene que vaciar el resultado cuando no hay clave (sin sesión de super admin)
  assert.match(guard, /if \(!clave\) \{\s*setResultado\(null\)\s*return undefined/)
  // y el resultado sólo vale si es de la misma cuenta que está ahora
  assert.match(guard, /resultadoVigente\(resultado, clave\)/)
})

// ── Re-login de la misma cuenta sin pasar por "sin sesión" ──────────────────
const jwt = claims => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`
const CUENTA = 'aaaa-1111'

test('sesionIdDeToken lee el claim session_id; sin token o sin claim → null', () => {
  assert.equal(sesionIdDeToken(jwt({ session_id: 's1', aal: 'aal1' })), 's1')
  assert.equal(sesionIdDeToken(jwt({ aal: 'aal1' })), null)
  assert.equal(sesionIdDeToken('basura'), null)
  assert.equal(sesionIdDeToken(null), null)
})

test('re-login de la misma cuenta (sesión nueva) NO hereda el NINGUNO de la sesión anterior', () => {
  // 1. sesión vieja, ya en aal2: el guard guardó "ninguno" bajo su clave
  const claveVieja = claveDeEvaluacion(CUENTA, sesionIdDeToken(jwt({ session_id: 'vieja', aal: 'aal2' })))
  const guardado = { clave: claveVieja, paso: PASO_MFA.NINGUNO }
  assert.equal(resultadoVigente(guardado, claveVieja), guardado)

  // 2. la misma cuenta entra de nuevo SIN cerrar sesión (o llega un SIGNED_IN de otra pestaña):
  //    sesión nueva en aal1 → otra clave → el resultado viejo ya no vale y hay que re-evaluar (spinner)
  const claveNueva = claveDeEvaluacion(CUENTA, sesionIdDeToken(jwt({ session_id: 'nueva', aal: 'aal1' })))
  assert.notEqual(claveNueva, claveVieja)
  assert.equal(resultadoVigente(guardado, claveNueva), null)

  // 3. con la sesión nueva evaluada en aal1 y con factor, el paso es pedir el código
  assert.equal(decidirPasoMfa({ role: 'super_admin', currentLevel: 'aal1', tieneFactor: true }), PASO_MFA.VERIFICAR)
})

test('el refresh del token (misma sesión) y el paso a aal2 conservan la clave: no hay spinner cada hora', () => {
  const a = claveDeEvaluacion(CUENTA, sesionIdDeToken(jwt({ session_id: 's1', aal: 'aal1', iat: 1 })))
  const b = claveDeEvaluacion(CUENTA, sesionIdDeToken(jwt({ session_id: 's1', aal: 'aal2', iat: 999 })))
  assert.equal(a, b)
})

test('sin cuenta o sin sesión no hay clave; un resultado nunca vale sin clave', () => {
  assert.equal(claveDeEvaluacion(null, 's1'), null)
  assert.equal(claveDeEvaluacion(CUENTA, null), null)
  assert.equal(resultadoVigente({ clave: 'x', paso: PASO_MFA.NINGUNO }, null), null)
})

test('MfaGuard keyea por sesión: escucha onAuthStateChange sin await adentro, y no usa profile.id a secas', () => {
  const guard = leer('src/components/auth/MfaGuard.jsx')
  assert.match(guard, /supabase\.auth\.onAuthStateChange\(\(_evento, session\) => \{\s*setSesionId\(idDeSesion\(session\)\)/)
  assert.match(guard, /claveDeEvaluacion\(profile\.id, sesionId\)/)
  assert.match(guard, /resultadoVigente\(resultado, clave\)/)
  assert.doesNotMatch(guard, /const clave = esSuperAdmin \? profile\.id : null/)
})
