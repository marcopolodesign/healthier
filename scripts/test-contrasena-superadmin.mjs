// Control de "lo arreglado no vuelve" para cambiar la contraseña propia del
// super admin (Mateo, 2026-10-29: "agreguemos esa pantalla para cambiar la
// contraseña, es necesaria"). Falla si:
//   1. la validación acepta una contraseña corta o dos que no coinciden;
//   2. el formulario deja de validar con `validarContrasena` o de mostrar el error real;
//   3. la pantalla deja de llamar a authService.updatePassword con la contraseña
//      nueva, o ese método deja de llamar a supabase.auth.updateUser({ password });
//   4. la ruta /super-admin/perfil o sus accesos (menú de escritorio y "Más" del
//      teléfono) desaparecen;
//   5. la pantalla del segundo factor pasa a estar linkeada (sigue sin promocionarse).
//   npm run test:contrasena
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MIN_CONTRASENA, validarContrasena } from '../src/lib/contrasena.js'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = ruta => readFileSync(join(RAIZ, ruta), 'utf8')

test('una contraseña corta se rechaza con el mínimo en el mensaje', () => {
  assert.equal(MIN_CONTRASENA, 6)
  for (const corta of ['', 'a', '12345']) {
    assert.match(validarContrasena(corta, corta), /al menos 6 caracteres/, `"${corta}"`)
  }
  assert.match(validarContrasena(undefined, undefined), /al menos 6 caracteres/)
})

test('dos contraseñas distintas se rechazan', () => {
  assert.match(validarContrasena('abcdef', 'abcdeg'), /no coinciden/)
  assert.match(validarContrasena('abcdef', ''), /no coinciden/)
  assert.match(validarContrasena('abcdef', 'ABCDEF'), /no coinciden/)
})

test('una contraseña del largo mínimo que coincide se acepta', () => {
  assert.equal(validarContrasena('abcdef', 'abcdef'), '')
  assert.equal(validarContrasena('una contraseña larga 123', 'una contraseña larga 123'), '')
})

test('el formulario valida con validarContrasena antes de llamar a onSubmit y muestra el error real', () => {
  const form = leer('src/components/auth/NuevaContrasenaForm.jsx')
  assert.match(form, /validarContrasena\(form\.password, form\.repetir\)/)
  const valida = form.indexOf('validarContrasena(form.password')
  const envia = form.indexOf('await onSubmit(form.password)')
  assert.ok(valida > -1 && envia > valida, 'la validación tiene que ir antes de onSubmit')
  assert.match(form, /catch \(err\) \{\s*setError\(err\.message\)/)
})

test('la pantalla guarda llamando a authService.updatePassword con la contraseña nueva', () => {
  const pantalla = leer('src/pages/super-admin/Contrasena.jsx')
  assert.match(pantalla, /<NuevaContrasenaForm[^>]*onSubmit=\{guardar\}/)
  assert.match(pantalla, /authService\.updatePassword\(password\)/)
  const servicio = leer('src/services/authService.js')
  assert.match(servicio, /async updatePassword\(password\) \{\s*const \{ data, error \} = await supabase\.auth\.updateUser\(\{ password \}\)/)
  assert.match(servicio, /if \(error\) throw new Error\(traducirErrorDeAuth\(error\)\)/)
})

test('la ruta existe y se llega desde el menú de escritorio y desde "Más" del teléfono', () => {
  assert.match(leer('src/App.jsx'), /path="\/super-admin\/perfil" element=\{<SuperAdminContrasena \/>\}/)
  assert.match(leer('src/components/Sidebar.jsx'), /to: '\/super-admin\/perfil'/)
  assert.match(leer('src/components/super-admin/SuperAdminBottomNav.jsx'), /path: '\/super-admin\/perfil'/)
})

test('el segundo factor sigue sin promocionarse en los menús', () => {
  assert.doesNotMatch(leer('src/components/Sidebar.jsx'), /super-admin\/seguridad/)
  assert.doesNotMatch(leer('src/components/super-admin/SuperAdminBottomNav.jsx'), /super-admin\/seguridad/)
})
