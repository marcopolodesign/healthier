// Control: el aviso del front y el corte de `rcta-certificado` deciden igual
// cuándo una consulta se puede certificar (Mateo, 2026-11-02: una 'confirmed'
// desde la hora del turno). Corre con `npm run test:certificados`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { consultaNoCertificable as web } from '../src/lib/certificadoAtencion.js'
import { consultaNoCertificable as fn } from '../supabase/functions/rcta-certificado/armado.ts'

const ahora = Date.parse('2026-11-02T15:00:00Z')
const casos = [
  ['cancelled', null, null], ['no_show', null, '2026-11-02T14:00:00Z'], ['expired', null, null],
  ['pending', null, null], ['pending', null, '2026-11-02T14:00:00Z'],
  ['confirmed', null, '2026-11-02T15:00:00Z'], ['confirmed', null, '2026-11-02T14:59:00Z'],
  ['confirmed', null, '2026-11-02T15:01:00Z'], ['confirmed', null, '2026-11-03T15:00:00Z'], ['confirmed', null, null],
  ['in_progress', null, '2026-11-03T15:00:00Z'], ['closing', null, null], ['pending_pro_close', null, null],
  ['completed', null, null], ['confirmed', '2026-11-02T14:55:00Z', '2026-11-03T15:00:00Z'],
]

test('web y función: misma decisión en cada caso', () => {
  for (const [status, started_at, scheduled_at] of casos) {
    const c = { status, started_at, scheduled_at }
    assert.deepEqual(web(c, ahora), fn(c, ahora), JSON.stringify(c))
  }
})

test("una 'confirmed' se puede certificar desde la hora del turno, no antes", () => {
  assert.equal(web({ status: 'confirmed', started_at: null, scheduled_at: '2026-11-02T15:00:00Z' }, ahora), null)
  assert.equal(web({ status: 'confirmed', started_at: null, scheduled_at: '2026-11-02T15:01:00Z' }, ahora)?.code, 'CERT_CONSULTA_FUTURA')
})

test('la hoja de firma no se apila sobre la vista previa (se cierra antes de pedir la firma)', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/components/professional/CertificadoCreator.jsx', import.meta.url), 'utf8')
  assert.match(src, /function pedirFirma\(\) \{ setPrevia\(null\); setFirmaPendiente\(true\) \}/)
  // Nadie abre la hoja de firma por otro camino.
  assert.equal((src.match(/setFirmaPendiente\(true\)/g) ?? []).length, 1)
})
