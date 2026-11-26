// Control de la validación del aviso de Mercado Pago (mp-webhook).
//   deno test scripts/test-firma-mp.ts
// Con un secreto de prueba: el real de MP vive sólo en los secrets de Supabase.
import { assertEquals } from 'jsr:@std/assert@1'
import { firmarAvisoMp, validarAvisoMp, MAX_EDAD_MS } from '../supabase/functions/_shared/firmaMp.ts'

const SECRET = 'secreto-de-prueba'
const ahora = Date.parse('2026-11-25T22:00:00Z')
const tsMs = String(ahora - 60_000)

Deno.test('aviso bien firmado, reciente y con el mismo data.id → ok', async () => {
  const sig = await firmarAvisoMp(SECRET, '123456', 'req-1', tsMs)
  const r = await validarAvisoMp({ secret: SECRET, xSignature: sig, xRequestId: 'req-1', queryDataId: '123456', bodyDataId: '123456', ahoraMs: ahora })
  assertEquals(r, { ok: true, dataId: '123456' })
})

Deno.test('ts en segundos también vale', async () => {
  const ts = String(Math.floor((ahora - 60_000) / 1000))
  const sig = await firmarAvisoMp(SECRET, '123456', 'req-1', ts)
  const r = await validarAvisoMp({ secret: SECRET, xSignature: sig, xRequestId: 'req-1', queryDataId: '123456', bodyDataId: '123456', ahoraMs: ahora })
  assertEquals(r.ok, true)
})

Deno.test('body.data.id distinto del firmado → rechazado', async () => {
  const sig = await firmarAvisoMp(SECRET, '123456', 'req-1', tsMs)
  const r = await validarAvisoMp({ secret: SECRET, xSignature: sig, xRequestId: 'req-1', queryDataId: '123456', bodyDataId: '999999', ahoraMs: ahora })
  assertEquals(r, { ok: false, motivo: 'data_id_distinto' })
})

Deno.test('ts de más de 10 minutos → rechazado', async () => {
  const viejo = String(ahora - MAX_EDAD_MS - 1000)
  const sig = await firmarAvisoMp(SECRET, '123456', 'req-1', viejo)
  const r = await validarAvisoMp({ secret: SECRET, xSignature: sig, xRequestId: 'req-1', queryDataId: '123456', bodyDataId: '123456', ahoraMs: ahora })
  assertEquals(r, { ok: false, motivo: 'ts_viejo' })
})

Deno.test('firma de otro data.id → rechazado', async () => {
  const sig = await firmarAvisoMp(SECRET, '111', 'req-1', tsMs)
  const r = await validarAvisoMp({ secret: SECRET, xSignature: sig, xRequestId: 'req-1', queryDataId: '123456', bodyDataId: '123456', ahoraMs: ahora })
  assertEquals(r, { ok: false, motivo: 'firma_invalida' })
})

Deno.test('sin firma → rechazado', async () => {
  const r = await validarAvisoMp({ secret: SECRET, xSignature: null, xRequestId: null, queryDataId: '1', bodyDataId: '1', ahoraMs: ahora })
  assertEquals(r, { ok: false, motivo: 'sin_firma' })
})
