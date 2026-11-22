#!/usr/bin/env node
// Control del rediseño de la farmacia del paciente (2026-11-22). Sin red.
//   node scripts/test-farmacia-rediseno.mjs
// Falla si (1) el nombre legible deja de formatear los casos del catálogo
// real, o (2) el reparto de necesidades se vuelve menos conservador: un
// antibiótico que deja de estar en "Antibióticos", Ely Diar (levofloxacina)
// que cae en "Digestión", o algo dudoso (estatinas, oncológicos,
// anticonceptivos) que recibe necesidad.
import { nombreLegible } from '../src/lib/pharmacyProducts.js'
import { necesidadDe } from './farmacia-necesidades.mjs'

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
]) igual(necesidadDe(nombre), necesidad, `necesidad de ${nombre}`)

console.log(fallas ? `\n🔴 ${fallas} falla(s)` : '\nTODO OK')
process.exit(fallas ? 1 : 0)
