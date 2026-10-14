// Control de "lo arreglado no vuelve": profesional "Sin ubicar" (Melody
// Parrillas, 2026-10-14). Falla si
//   1. algún lugar que guarda la dirección de un profesional no la pasa por
//      `conCoordenadas` (o por el `upsert` del servicio, que también la cubre);
//   2. `variantesDeDireccion` deja de quitar el CP / "Province" / el nombre doble
//      de "Calle 99 - Zárate Villa Progreso";
//   3. (con red) la dirección de Melody y un par más dejan de ubicarse.
//   npm run test:geo          # sin red: 1 y 2     |  GEO_LIVE=1 npm run test:geo: + 3
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { variantesDeDireccion, candidatasDeDireccion, geocodeAddress, conCoordenadas } from '../src/lib/geo.js'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const MELODY = 'Calle 99 - Zárate Villa Progreso, B1502HQG Villa Lynch, Buenos Aires Province'

function archivos(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? archivos(p) : /\.(jsx?|tsx?)$/.test(n) ? [p] : []
  })
}

test('todo camino que ESCRIBE la dirección del profesional intenta geocodificar', () => {
  const sospechosos = archivos(SRC).filter(f => {
    const t = readFileSync(f, 'utf8')
    // Escribe en professional_profiles, directo o por el servicio.
    const escribe = /from\('professional_profiles'\)[\s\S]{0,120}?\.(upsert|update|insert)\(|professionalService\.upsert\(/.test(t)
    const tocaPro = escribe
    // `address` como clave de lo que se guarda (no sólo en un select)
    const guardaDireccion = /(^|[\s{,])address\s*[:,}]/m.test(t.replace(/\.select\([^)]*\)/g, ''))
    return escribe && tocaPro && guardaDireccion && !/conCoordenadas/.test(t)
  })
  assert.deepEqual(sospechosos.map(f => f.replace(SRC, 'src')), [],
    'estos archivos guardan una dirección de profesional sin pasar por conCoordenadas (src/lib/geo.js)')
})

test('el upsert del servicio es la red de seguridad: geocodifica si la dirección llega sin latitud', () => {
  const t = readFileSync(join(SRC, 'services', 'professionalService.js'), 'utf8')
  assert.match(t, /import \{ conCoordenadas \} from '..\/lib\/geo'/)
  assert.match(t, /rest\.address && rest\.latitude === undefined/)
})

test('los dos lugares de edición usan conCoordenadas y avisan si no se ubicó', () => {
  const perfil = readFileSync(join(SRC, 'pages/professional/Profile.jsx'), 'utf8')
  assert.match(perfil, /await conCoordenadas\(form\)/)
  assert.match(perfil, /data-testid="direccion-sin-ubicar"/)
  const admin = readFileSync(join(SRC, 'pages/super-admin/Profesionales.jsx'), 'utf8')
  assert.match(admin, /await conCoordenadas\(direccion\)/)
  assert.match(admin, /no pudimos ubicarla en el mapa/)
})

test('Melody: se quitan CP, "Province" y el nombre doble, y sale "Zárate 99, Villa Progreso"', () => {
  const v = variantesDeDireccion(MELODY)
  assert.ok(v.includes('Zárate 99, Villa Progreso'), v.join(' | '))
  assert.ok(!v.slice(2).some(q => /B1502HQG|Province/.test(q)), 'las recortadas no llevan CP ni Province')
  const c = candidatasDeDireccion(MELODY).find(c => c.q === 'Zárate 99, Villa Progreso')
  assert.equal(c.exigir, 'Villa Progreso', 'la recortada exige su barrio en el resultado: no se acepta otra ciudad')
})

test('no inventa: sin zona escrita no hay candidata recortada', () => {
  assert.deepEqual(variantesDeDireccion('Zárate 99'), ['Zárate 99', 'Zárate 99, Buenos Aires'])
  assert.ok(variantesDeDireccion('Av. Santa Fe 1900, C1123AAB Cdad. Autónoma de Buenos Aires, Argentina')
    .includes('Av. Santa Fe 1900, Buenos Aires'))
})

test('conCoordenadas no pisa coordenadas elegidas de una sugerencia', async () => {
  assert.deepEqual(await conCoordenadas({ address: ' X 1 ', latitude: -34.5, longitude: -58.4 }),
    { address: 'X 1', latitude: -34.5, longitude: -58.4 })
})

const live = process.env.GEO_LIVE === '1'
for (const [nombre, dir, lat, lng] of [
  ['Melody (Google Places en inglés, CP, doble nombre)', MELODY, -34.5868, -58.5329],
  ['Arenales 3709 1A Palermo', 'Arenales 3709 1A Palermo', -34.585, -58.414],
  ['Google Places con CP y Cdad. Autónoma', 'Av. Santa Fe 1900, C1123AAB Cdad. Autónoma de Buenos Aires, Argentina', -34.596, -58.395],
]) {
  test(`(con red) ${nombre} se ubica`, { skip: !live && 'GEO_LIVE=1 para probar contra Nominatim' }, async () => {
    const g = await geocodeAddress(dir)
    assert.ok(g, 'no se ubicó')
    assert.ok(Math.abs(g.lat - lat) < 0.01 && Math.abs(g.lng - lng) < 0.01, JSON.stringify(g))
  })
}
