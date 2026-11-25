#!/usr/bin/env node
// Control del rediseño de la farmacia del paciente (2026-11-22) y de la
// necesidad automática (migración 248, 2026-11-25).
//   npm run test:farmacia            (nombres sin red + necesidades contra STAGING)
//   npm run test:farmacia -- --sin-red   (sólo los nombres)
//
// Falla si:
//  (1) el nombre legible deja de formatear los casos del catálogo real;
//  (2) la regla de necesidades se vuelve menos conservadora: un antibiótico
//      que deja de estar en "Antibióticos", Ely Diar (levofloxacina) que cae
//      en "Digestión", o algo dudoso (estatinas, oncológicos,
//      anticonceptivos) que recibe necesidad;
//  (3) un producto que entra SIN necesidad no la recibe sola (queda 'auto',
//      para revisar), o la regla PISA una necesidad que eligió la farmacia.
// La parte (2)–(3) corre contra la base de staging (la regla vive en la base:
// `farmacia_necesidad_reglas` + trigger). Crea productos de prueba y los
// borra al terminar.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { nombreLegible } from '../src/lib/pharmacyProducts.js'

let fallas = 0
const igual = (dado, esperado, que) => {
  const ok = dado === esperado
  if (!ok) fallas++
  console.log(`${ok ? '🟢' : '🔴'} ${que}: ${JSON.stringify(dado)}${ok ? '' : ` (esperado ${JSON.stringify(esperado)})`}`)
}

for (const [crudo, legible] of [
  ['Sulocten 5 Mg Comp X 60', 'Sulocten 5 mg · 60 comp.'],
  ['Dioxis Cr X 5 G', 'Dioxis crema · 5 g'],
  ['Alprazolam Micr.0.5Mg Compx30', 'Alprazolam 0.5 mg · 30 comp.'],
  ['Redugluc Ap Fte 1000Mg Cmx 30', 'Redugluc AP Forte 1000 mg · 30 comp.'],
  ['Perlivit Ha Fps55 Emuls X45G', 'Perlivit HA FPS 55 emulsión · 45 g'],
  ['Entarsol 6.25 Mg Comp Recx30', 'Entarsol 6.25 mg · 30 comp. rec.'],
  ['Rhinal Gts X 30 Ml', 'Rhinal gotas · 30 ml'],
  ['Diastone Flex Comp X 10', 'Diastone Flex · 10 comp.'],
  ['Cracox 90 Mg Comp X 14', 'Cracox 90 mg · 14 comp.'],
  ['Perlivit Ha Rost/Cue Serx28Ml', 'Perlivit HA rostro y cuello sérum · 28 ml'],
]) igual(nombreLegible(crudo), legible, crudo)

function leerEnv(archivo) {
  const env = {}
  for (const linea of readFileSync(archivo, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linea)
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return env
}

async function necesidades() {
  const env = leerEnv(path.join(homedir(), 'Local/.env'))
  const url = env.HEALTHIER_STAGING_SUPABASE_URL
  const key = env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.log('🔴 faltan HEALTHIER_STAGING_* en ~/Local/.env'); fallas++; return }
  const sb = createClient(url, key, { auth: { persistSession: false } })

  // (2) La regla, tal como la aplica la base.
  for (const [nombre, necesidad] of [
    ['Nobactam 500 Mg Comp X 16', 'antibioticos'],
    ['Ely Diar 750 Mg Comp X 5', 'antibioticos'],
    ['Tanezox 500 Mg Comp X 3', 'antibioticos'],
    ['Sindolito 4% Susp X 100 Ml', 'dolor'],
    ['Mell 15 Mg Comp X 10', 'dolor'],
    ['Coris Grip Comp X 10', 'resfrio'],
    ['Perlivit Ha Lips Cristalx 3G', 'piel'],
    ['Redugluc 500 Mg Comp X 30', 'presion'],
    ['Oblisec 20 Mg Caps X 30', 'digestion'],
    ['Finlipol 10 Mg Comp X 30', null],
    ['Onkostatil 10Mg F-A X1', null],
    ['Forlady Comp X 21', null],
    ['Alprazolam Micr.1 Mg Compx30', null],
    ['Microterol Sol P/Neb X 20 Ml', null],
    ['Procto-Metadyne Cr X 20 G', null],
  ]) {
    const { data, error } = await sb.rpc('farmacia_necesidad_sugerida', { p_nombre: nombre })
    if (error) { console.log(`🔴 farmacia_necesidad_sugerida: ${error.message} (¿falta la migración 248?)`); fallas++; return }
    igual(data, necesidad, `regla para ${nombre}`)
  }

  // (3) El alta y lo manual, con productos de prueba.
  const { data: uno } = await sb.from('pharmacy_products').select('pharmacy_id').limit(1).single()
  const marca = `TEST-NEC-${Date.now()}`
  let n = 0
  const alta = (nombre, extra = {}) => sb.from('pharmacy_products')
    .insert({ pharmacy_id: uno.pharmacy_id, name: nombre, category: 'clinica', price: 1, sku: `${marca}-${++n}`, in_stock: false, ...extra })
    .select('id, necesidad, necesidad_origen').single()
  const ids = []
  try {
    const a = await alta('Coris Grip Comp X 10 (prueba)')
    if (a.error) throw a.error
    ids.push(a.data.id)
    igual(a.data.necesidad, 'resfrio', 'alta sin necesidad → la pone la regla')
    igual(a.data.necesidad_origen, 'auto', 'alta sin necesidad → queda para revisar')

    const b = await alta('Finlipol 10 Mg Comp X 30 (prueba)')
    if (b.error) throw b.error
    ids.push(b.data.id)
    igual(b.data.necesidad, null, 'alta dudosa → sin necesidad')
    igual(b.data.necesidad_origen, null, 'alta dudosa → nada para revisar')

    const c = await alta('Coris Grip Jarabe (prueba)', { necesidad: 'piel' })
    if (c.error) throw c.error
    ids.push(c.data.id)
    igual(c.data.necesidad, 'piel', 'alta con necesidad elegida → se respeta')
    igual(c.data.necesidad_origen, 'farmacia', 'alta con necesidad elegida → es de la farmacia')

    // La farmacia cambia a mano la que puso la regla (sin mandar el origen).
    const m = await sb.from('pharmacy_products').update({ necesidad: 'dolor' }).eq('id', a.data.id).select('necesidad, necesidad_origen').single()
    igual(m.data?.necesidad_origen, 'farmacia', 'cambio a mano → queda de la farmacia')
    // La farmacia le saca la necesidad a mano.
    await sb.from('pharmacy_products').update({ necesidad: null }).eq('id', c.data.id)

    // La asignación en bloque (lo que corre el script, aun forzando) no las pisa.
    const { error: eb } = await sb.rpc('farmacia_asignar_necesidades', { p_forzar: true })
    if (eb) throw eb
    const { data: despues } = await sb.from('pharmacy_products').select('id, necesidad, necesidad_origen').in('id', ids)
    const de = (id) => despues.find(x => x.id === id)
    igual(de(a.data.id).necesidad, 'dolor', 'el script no pisa lo que eligió la farmacia')
    igual(de(c.data.id).necesidad, null, 'el script no vuelve a poner lo que la farmacia sacó')
    igual(de(b.data.id).necesidad, null, 'el script sigue sin tocar lo dudoso')
  } catch (err) {
    console.log(`🔴 ${err.message ?? err}`); fallas++
  } finally {
    if (ids.length) await sb.from('pharmacy_products').delete().in('id', ids)
  }
}

if (!process.argv.includes('--sin-red')) await necesidades()

console.log(fallas ? `\n🔴 ${fallas} falla(s)` : '\nTODO OK')
process.exit(fallas ? 1 : 0)
