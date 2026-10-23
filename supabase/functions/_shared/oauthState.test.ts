// deno test supabase/functions/_shared/oauthState.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { buildOAuthState, OAUTH_STATE_TTL_SECONDS, verifyOAuthState } from './oauthState.ts'

const SECRET = 'secreto-de-prueba'
const ID = '5eed0000-0000-0000-0000-000000000001'
const T0 = Date.UTC(2026, 9, 23, 12, 0, 0)

Deno.test('ida y vuelta: el state firmado devuelve el mismo id', async () => {
  const s = await buildOAuthState('mp-connect', ID, SECRET, T0)
  assertEquals(await verifyOAuthState('mp-connect', s, SECRET, T0 + 60_000), { ok: true, entityId: ID })
})

Deno.test('vence a los 15 minutos', async () => {
  const s = await buildOAuthState('mp-connect', ID, SECRET, T0)
  const despues = T0 + (OAUTH_STATE_TTL_SECONDS + 1) * 1000
  assertEquals(await verifyOAuthState('mp-connect', s, SECRET, despues), { ok: false, reason: 'expired' })
})

Deno.test('un state del profesional no sirve para la farmacia', async () => {
  const s = await buildOAuthState('mp-connect', ID, SECRET, T0)
  assertEquals((await verifyOAuthState('pharmacy-mp-connect', s, SECRET, T0)).ok, false)
})

Deno.test('cambiar el id o estirar el vencimiento rompe la firma', async () => {
  const s = await buildOAuthState('mp-connect', ID, SECRET, T0)
  const [v, , exp, sig] = s.split('.')
  const otroId = `${v}.5eed0000-0000-0000-0000-000000000002.${exp}.${sig}`
  const masTarde = `${v}.${ID}.${Number(exp) + 86400}.${sig}`
  assertEquals((await verifyOAuthState('mp-connect', otroId, SECRET, T0)).ok, false)
  assertEquals((await verifyOAuthState('mp-connect', masTarde, SECRET, T0)).ok, false)
})

Deno.test('el formato viejo (id.hmac16, sin vencimiento) ya no se acepta', async () => {
  assertEquals((await verifyOAuthState('mp-connect', `${ID}.0123456789abcdef`, SECRET, T0)).ok, false)
})

Deno.test('sin secreto no se firma ni se valida', async () => {
  const s = await buildOAuthState('mp-connect', ID, SECRET, T0)
  assertEquals((await verifyOAuthState('mp-connect', s, '', T0)).ok, false)
})
