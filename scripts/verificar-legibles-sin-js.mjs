#!/usr/bin/env node
// Control: la principal, la política de privacidad y los términos se leen SIN JavaScript.
//
// Por qué existe: Google rechazó la verificación de marca de "Iniciar sesión con Google"
// porque su revisor no ejecuta JS y las tres URLs devolvían el mismo shell vacío de la SPA
// (~41 caracteres visibles). Si alguien vuelve a vaciar el #root de index.html, a mandar
// /terminos o /privacidad a la SPA, o a sacar la sección de datos de Google, esto falla.
//
//   node scripts/verificar-legibles-sin-js.mjs                     # producción
//   node scripts/verificar-legibles-sin-js.mjs https://staging.healthier.com.ar

const base = (process.argv[2] || 'https://www.healthier.com.ar').replace(/\/$/, '')

const textoVisible = (html) =>
  html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const CASOS = [
  {
    ruta: '/',
    minimo: 600,
    debe: ['<h1>Healthier</h1>', 'United Health S.A.', 'href="/privacidad"', 'href="/terminos"', 'Iniciar sesión con Google'],
  },
  {
    ruta: '/privacidad',
    minimo: 6000,
    debe: ['Política de privacidad', 'United Health S.A.', 'Uso de datos de usuarios de Google', 'Uso Limitado', 'Limited Use', 'Ley 25.326', 'info@healthier.com.ar'],
  },
  {
    ruta: '/terminos',
    minimo: 3000,
    debe: ['Términos y condiciones', 'United Health S.A.', 'href="/privacidad"', 'Ley 26.529'],
  },
]

// Nombres de proveedores que no pueden aparecer en copy visible (regla de Mateo).
const PROHIBIDOS = [/innovamed/i, /\brcta\b/i, /gethealthier\.app/i]

let fallas = 0
for (const { ruta, minimo, debe } of CASOS) {
  const url = base + ruta
  let res
  try {
    res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'verificar-legibles-sin-js' } })
  } catch (e) {
    console.log(`✗ ${ruta} — no responde: ${e.message}`)
    fallas++
    continue
  }
  const html = await res.text()
  const texto = textoVisible(html)
  const problemas = []
  if (res.status !== 200) problemas.push(`HTTP ${res.status}`)
  if (texto.length < minimo) problemas.push(`sólo ${texto.length} caracteres visibles sin JS (mínimo ${minimo})`)
  for (const s of debe) if (!html.includes(s)) problemas.push(`falta "${s}"`)
  for (const re of PROHIBIDOS) if (re.test(texto)) problemas.push(`aparece ${re}`)
  if (problemas.length) {
    fallas++
    console.log(`✗ ${ruta} — ${problemas.join('; ')}`)
  } else {
    console.log(`✓ ${ruta} — ${texto.length} caracteres visibles sin JS`)
  }
}

// El link viejo (con el typo) que quedó cargado en la marca de Google tiene que llevar a la política.
try {
  const r = await fetch(base + '/compilance-argentina.html', { redirect: 'manual' })
  const destino = r.headers.get('location') || ''
  if (r.status >= 300 && r.status < 400 && destino.endsWith('/privacidad')) {
    console.log('✓ /compilance-argentina.html → /privacidad')
  } else {
    fallas++
    console.log(`✗ /compilance-argentina.html — esperaba redirección a /privacidad, vino ${r.status} ${destino}`)
  }
} catch (e) {
  fallas++
  console.log(`✗ /compilance-argentina.html — ${e.message}`)
}

console.log(fallas ? `\n${fallas} problema(s) en ${base}` : `\nTodo legible sin JS en ${base}`)
process.exit(fallas ? 1 : 0)
