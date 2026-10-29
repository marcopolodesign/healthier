// Control de "lo arreglado no vuelve" para cambiar la contraseña propia del
// super admin (Mateo, 2026-10-29: "agreguemos esa pantalla para cambiar la
// contraseña, es necesaria"). Falla si:
//   1. la validación acepta una contraseña corta o dos que no coinciden;
//   2. los errores de Supabase Auth dejan de traducirse con qué hacer (en el panel,
//      `session_not_found` NO manda a "pedir otro mail");
//   3. el flujo deja de llamar a updateUser con la contraseña nueva, de verificar la
//      actual (cuenta con contraseña) o de asentar el cambio en el registro de admins;
//   4. la ruta /super-admin/perfil o sus accesos (menú de escritorio y "Más" del
//      teléfono) desaparecen;
//   5. la pantalla del segundo factor pasa a estar linkeada (sigue sin promocionarse).
// El comportamiento contra la base (tengo_contrasena, el asiento, que un paciente no
// pueda asentar) lo prueba `npm run test:registro-admin` (sección 13, staging).
//   npm run test:contrasena
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MIN_CONTRASENA, validarContrasena } from '../src/lib/contrasena.js'
import { traducirErrorDeAuth } from '../src/lib/errorDeAuth.js'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = ruta => readFileSync(join(RAIZ, ruta), 'utf8')

test('validarContrasena: cada caso, como datos', () => {
  assert.equal(MIN_CONTRASENA, 6)
  const casos = [
    // [nueva, repetida, qué dice el error ('' = sirve)]
    ['', '', /al menos 6 caracteres/],
    ['a', 'a', /al menos 6 caracteres/],
    ['12345', '12345', /al menos 6 caracteres/],
    [undefined, undefined, /al menos 6 caracteres/],
    ['abcdef', 'abcdeg', /no coinciden/],
    ['abcdef', '', /no coinciden/],
    ['abcdef', 'ABCDEF', /no coinciden/],
    ['abcdef', 'abcdef', ''],
    ['una contraseña larga 123', 'una contraseña larga 123', ''],
  ]
  for (const [nueva, repetida, esperado] of casos) {
    const res = validarContrasena(nueva, repetida)
    if (esperado === '') assert.equal(res, '', `"${nueva}" / "${repetida}" tendría que servir`)
    else assert.match(res, esperado, `"${nueva}" / "${repetida}"`)
  }
})

test('traducirErrorDeAuth en el panel: sesión vencida manda a volver a entrar, no a pedir un mail', () => {
  const panel = { contexto: 'panel' }
  const casos = [
    [{ code: 'session_not_found' }, /^Tu sesión venció\. Volvé a entrar e intentá de nuevo\.$/],
    [{ message: 'Auth session missing!' }, /^Tu sesión venció\. Volvé a entrar/],
    [{ code: 'reauthentication_needed' }, /vuelvas a iniciar sesión/],
    [{ message: 'Password update requires reauthentication' }, /vuelvas a iniciar sesión/],
    [{ code: 'insufficient_aal' }, /código de tu app de códigos/],
    [{ message: 'AAL2 session is required to update email or password when MFA is enabled.' }, /código de tu app de códigos/],
    [{ code: 'same_password' }, /distinta de la anterior/],
    [{ code: 'weak_password' }, /muy débil/],
    [{ code: 'over_email_send_rate_limit' }, /demasiados mails/],
  ]
  for (const [error, esperado] of casos) assert.match(traducirErrorDeAuth(error, panel), esperado, JSON.stringify(error))
  for (const [error] of casos.slice(0, 2)) assert.doesNotMatch(traducirErrorDeAuth(error, panel), /otro mail/)
  // lo que no se conoce se muestra tal cual, nunca mudo
  assert.equal(traducirErrorDeAuth({ message: 'algo raro de Auth' }, panel), 'algo raro de Auth')
})

test('traducirErrorDeAuth en la recuperación por mail sigue pidiendo otro mail (el flujo de /restablecer-contrasena no cambia)', () => {
  assert.match(traducirErrorDeAuth({ code: 'session_not_found' }), /Pedí otro mail/)
  assert.match(traducirErrorDeAuth({ message: 'Auth session missing!' }, { contexto: 'recuperacion' }), /Pedí otro mail/)
})

test('el formulario valida antes de llamar a onSubmit, pide la actual cuando corresponde y muestra el error real', () => {
  const form = leer('src/components/auth/NuevaContrasenaForm.jsx')
  const valida = form.indexOf('validarContrasena(form.password, form.repetir)')
  const envia = form.indexOf('await onSubmit(form.password')
  assert.ok(valida > -1 && envia > valida, 'la validación tiene que ir antes de onSubmit')
  assert.match(form, /pedirActual && !form\.actual/)
  assert.match(form, /autoComplete="current-password"/)
  assert.match(form, /autoComplete="username"/)
  assert.match(form, /catch \(err\) \{\s*setError\(err\.message\)/)
  assert.match(form, /from '\.\.\/\.\.\/lib\/contrasena'/)
})

test('el flujo: comprueba si tiene contraseña, verifica la actual, cambia con updateUser y asienta', () => {
  const pantalla = leer('src/pages/super-admin/Contrasena.jsx')
  assert.match(pantalla, /authService\.tengoContrasena\(\)/)
  assert.match(pantalla, /pedirActual=\{tiene\}/)
  assert.match(pantalla, /authService\.cambiarContrasenaPropia\(\{ nueva, actual, tieneContrasena: tiene \}\)/)

  const servicio = leer('src/services/authService.js')
  const fn = servicio.slice(servicio.indexOf('async cambiarContrasenaPropia'))
  const verifica = fn.indexOf('signInWithPassword')
  const actualiza = fn.indexOf('supabase.auth.updateUser({ password: nueva })')
  const asienta = fn.indexOf("rpc('registrar_cambio_de_contrasena'")
  assert.ok(verifica > -1 && actualiza > verifica && asienta > actualiza, 'orden: verificar la actual → updateUser → asentar')
  assert.match(fn, /clienteVerificador\(\)/, 'la actual se verifica con un cliente aparte, sin tocar la sesión de la pestaña')
  assert.match(servicio, /_verificador \?\?= crearClienteDescartable\(\)/, 'el cliente verificador se crea una sola vez (lazy), no uno por intento')
  assert.match(fn, /const \{ error: errSalida \} = await verificador\.auth\.signOut/, 'se revisa el error del signOut del verificador')
  assert.match(fn, /intento < 2/, 'si el asiento falla se reintenta una vez')
  assert.doesNotMatch(fn, /registrar_cambio_de_contrasena', \{/, 'el cliente no le dice al servidor si es la primera vez')
  assert.match(servicio, /rpc\('tengo_contrasena'\)/)
  assert.match(fn, /La contraseña actual no es correcta\./)
})

test('la migración 219: el estado y el asiento dependen de la base, no del cliente', () => {
  const sql = leer('supabase/migrations/219_cambio_de_contrasena_propia.sql')
  const sinComentarios = sql.replace(/^--.*$/gm, '')
  // tengo_contrasena: el hash solo no alcanza, y la señal persiste (no sólo mfa_amr_claims)
  assert.match(sinComentarios, /function public\._tiene_contrasena[\s\S]*?encrypted_password <> ''/)
  assert.match(sinComentarios, /_cambios_de_contrasena x[\s\S]*?mfa_amr_claims/, 'señales: cambio anotado, marca, y (legado) sesión con contraseña')
  assert.match(sinComentarios, /_contrasena_propia c where c\.user_id = u\.id/)
  // el cambio real lo anota un trigger sobre auth.users, sin copiar el hash
  assert.match(sinComentarios, /create trigger anotar_cambio_de_contrasena\s+after update of encrypted_password on auth\.users/)
  assert.match(sinComentarios, /old\.encrypted_password is distinct from new\.encrypted_password/)
  assert.doesNotMatch(sinComentarios, /insert into public\._cambios_de_contrasena \([^)]*encrypted_password/)
  // el asiento: sin parámetros del cliente, atado a un cambio real, reciente y no asentado, sólo admins
  assert.match(sinComentarios, /function public\.registrar_cambio_de_contrasena\(\)/)
  assert.match(sinComentarios, /drop function if exists public\.registrar_cambio_de_contrasena\(boolean\)/)
  assert.match(sinComentarios, /asentado_at is null and created_at > now\(\) - interval '5 minutes'/)
  assert.match(sinComentarios, /public\._aal_actor_es_admin\(\)/)
  assert.match(sinComentarios, /v_primera := not public\._tiene_contrasena\(v_uid, v_cambio\.created_at\)/)
  assert.match(sinComentarios, /insert into public\._contrasena_propia/)
  assert.match(sinComentarios, /'cambio_de_contrasena'/)
  // permisos: sólo sesiones, nunca anon; las tablas internas sin acceso para nadie
  assert.match(sinComentarios, /revoke all on function public\.tengo_contrasena\(\) from public, anon;/)
  assert.match(sinComentarios, /revoke all on function public\.registrar_cambio_de_contrasena\(\) from public, anon;/)
  assert.match(sinComentarios, /revoke all on public\._cambios_de_contrasena from public, anon, authenticated, service_role;/)
  assert.doesNotMatch(sinComentarios, /grant execute[^;]*\banon\b/i)
})

test('la ruta existe y se llega desde el menú de escritorio y desde "Más" del teléfono', () => {
  assert.match(leer('src/App.jsx'), /path="\/super-admin\/perfil" element=\{<SuperAdminContrasena profile=\{profile\} \/>\}/)
  assert.match(leer('src/components/Sidebar.jsx'), /to: '\/super-admin\/perfil'/)
  assert.match(leer('src/components/super-admin/SuperAdminBottomNav.jsx'), /path: '\/super-admin\/perfil'/)
})

test('el segundo factor sigue sin promocionarse en los menús', () => {
  assert.doesNotMatch(leer('src/components/Sidebar.jsx'), /super-admin\/seguridad/)
  assert.doesNotMatch(leer('src/components/super-admin/SuperAdminBottomNav.jsx'), /super-admin\/seguridad/)
})
