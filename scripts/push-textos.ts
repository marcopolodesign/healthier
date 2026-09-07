/**
 * La página de revisión de los avisos push — `npm run push` la genera en
 * `public/docs/push/textos.html` y se publica con el sitio.
 *
 * Hermana de la de los mails: sale del **mismo catálogo** que usa la Edge
 * Function para mandarlos (`_shared/push/textos.ts`), así que lo que el equipo
 * revisa es exactamente lo que le llega al usuario.
 *
 * Cada aviso se muestra como se ve de verdad: una notificación en la pantalla
 * bloqueada. Es la única forma de juzgar un push — un título que en una lista
 * parece bien, en el teléfono aparece cortado a los 40 caracteres.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AVISOS, construir, type Datos, type Tipo } from '../supabase/functions/_shared/push/textos.ts'

const OUT = join(import.meta.dirname, '..', 'public', 'docs', 'push')
mkdirSync(OUT, { recursive: true })

const enHoras = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

/** Datos de ejemplo, los mismos que la página de los mails. */
const EJEMPLO: Datos = {
  scheduledAt: enHoras(26),
  consultationId: '3f8c1a92-5d44-4e21-9c77-0a1b2c3d4e5f',
  orderId: '9b2e77c1-4a3f-4c8d-b1e6-77d0f9a1c2b3',
  pharmacyName: 'Farmacia del Águila',
  professionalName: 'Dra. Valentina Ortiz',
  medicamentos: ['Amoxicilina 500 mg', 'Ibuprofeno 400 mg'],
  motivo: 'La farmacia no tenía stock del antibiótico',
  isOnDemand: false,
  hasRoom: false,
  tieneReceta: true,
  permanente: false,
}

const esc = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const tipos = Object.keys(AVISOS) as Tipo[]
const GRUPOS: Array<{ titulo: string; filtro: (t: Tipo) => boolean }> = [
  { titulo: 'Al paciente · turnos y consultas', filtro: t => AVISOS[t].para === 'paciente' && !t.startsWith('pedido') && !t.startsWith('emergencia') && t !== 'receta-emitida' },
  { titulo: 'Al paciente · recetas y farmacia', filtro: t => AVISOS[t].para === 'paciente' && (t.startsWith('pedido') || t === 'receta-emitida') },
  { titulo: 'Al paciente · emergencias', filtro: t => AVISOS[t].para === 'paciente' && t.startsWith('emergencia') },
  { titulo: 'Al profesional', filtro: t => AVISOS[t].para === 'profesional' },
]

const tarjeta = (t: Tipo) => {
  const a = construir(t, EJEMPLO)!
  const meta = AVISOS[t]
  return `
    <article class="aviso" id="${esc(t)}">
      <div class="tel">
        <div class="notif">
          <div class="app"><span class="icono">H</span><span class="nombre">Healthier</span><span class="hace">ahora</span></div>
          <p class="titulo">${esc(a.title)}</p>
          <p class="texto">${esc(a.body)}</p>
        </div>
      </div>
      <div class="detalle">
        <p class="cuando"><span>Cuándo se manda</span>${esc(meta.cuando)}</p>
        <p class="lleva"><span>Al tocarla lleva a</span><code>${esc(a.url)}</code></p>
        <label class="obs">
          <span>Observaciones</span>
          <textarea data-slug="${esc(t)}" data-titulo="${esc(a.title)}" rows="2"
                    placeholder="Qué cambiarías de este texto…"></textarea>
        </label>
      </div>
    </article>`
}

const secciones = GRUPOS.map(g => {
  const items = tipos.filter(g.filtro)
  if (!items.length) return ''
  return `
  <section class="grupo">
    <h2 id="g-${esc(g.titulo).replace(/[^a-zA-Z]+/g, '-').toLowerCase()}">${esc(g.titulo)}</h2>
    ${items.map(tarjeta).join('')}
  </section>`
}).join('')

const nav = GRUPOS.filter(g => tipos.some(g.filtro)).map(g =>
  `<a href="#g-${esc(g.titulo).replace(/[^a-zA-Z]+/g, '-').toLowerCase()}">${esc(g.titulo)}</a>`).join('')

writeFileSync(join(OUT, 'textos.html'), `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Los avisos de Healthier</title>
<meta name="description" content="Las ${tipos.length} notificaciones que manda Healthier, como se ven en el teléfono.">
<style>
  @font-face{font-family:'Everett';src:url('/fonts/Everett-Light.woff2') format('woff2');
    font-weight:300;font-style:normal;font-display:swap}
  @font-face{font-family:'Everett';src:url('/fonts/Everett-Regular.woff2') format('woff2');
    font-weight:400 600;font-style:normal;font-display:swap}
  @font-face{font-family:'GeneralSans';src:url('/fonts/GeneralSans-Regular.woff2') format('woff2');
    font-weight:400;font-style:normal;font-display:swap}
  @font-face{font-family:'GeneralSans';src:url('/fonts/GeneralSans-Medium.woff2') format('woff2');
    font-weight:500 700;font-style:normal;font-display:swap}

  :root{
    --ink:#2D2A26; --body:#6B6560; --mute:#A8A29E; --line:#E7E3DC;
    --page:#F6F5F0; --card:#fff; --soft:#FAF9F5;
    --sage:#7CB38B; --sage-ink:#3F6B4C; --sage-soft:#EDF4EF;
    --serif:'Everett',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    --sans:'GeneralSans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--page);color:var(--ink);
    font:15px/1.65 var(--sans);-webkit-font-smoothing:antialiased}
  h1,h2{font-family:var(--serif);font-weight:400}

  .marca{text-align:center;padding:44px 20px 8px}
  .marca img{width:118px;height:auto}
  .marca h1{margin:22px 0 6px;font-size:30px;font-weight:300;letter-spacing:-.5px;line-height:1.2}
  .marca p{margin:0;font-size:14px;color:var(--body)}

  header.top{position:sticky;top:0;z-index:10;background:rgba(246,245,240,.92);
    backdrop-filter:blur(12px);border-bottom:1px solid var(--line);margin-top:26px}
  .wrap{max-width:760px;margin:0 auto;padding:0 20px}
  header.top .wrap{padding-top:12px;padding-bottom:11px}
  nav{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
  nav a{font-size:12px;font-weight:600;color:var(--sage-ink);background:var(--sage-soft);
    padding:5px 12px;border-radius:999px;text-decoration:none}
  nav a:hover{background:#e2eee7}

  main{padding:30px 0 96px}
  .intro{background:var(--card);border:1px solid var(--line);border-radius:26px;padding:28px 30px;margin-bottom:34px}
  .intro p{margin:0 0 10px;color:var(--body)} .intro p:last-child{margin:0}

  .grupo h2{margin:40px 0 16px;font-family:var(--sans);font-size:11px;letter-spacing:.1em;
    text-transform:uppercase;color:var(--mute);font-weight:600}
  .aviso{background:var(--card);border:1px solid var(--line);border-radius:26px;
    padding:24px;margin-bottom:14px;display:grid;grid-template-columns:320px 1fr;gap:26px;align-items:start}

  /* La notificación, como en la pantalla bloqueada */
  .tel{background:linear-gradient(160deg,#4a5d52,#2f3b34);border-radius:22px;padding:26px 14px}
  .notif{background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-radius:16px;padding:11px 13px;
    box-shadow:0 6px 18px rgba(0,0,0,.18)}
  .app{display:flex;align-items:center;gap:7px;margin-bottom:5px}
  .icono{width:17px;height:17px;border-radius:5px;background:var(--sage);color:#fff;font-size:11px;
    font-weight:700;display:flex;align-items:center;justify-content:center;font-family:var(--serif)}
  .nombre{font-size:11px;font-weight:600;color:#3c3a37;text-transform:uppercase;letter-spacing:.04em}
  .hace{margin-left:auto;font-size:11px;color:#8a8783}
  .notif .titulo{margin:0;font-size:14px;font-weight:600;color:#111;line-height:1.3}
  .notif .texto{margin:2px 0 0;font-size:13.5px;color:#3c3a37;line-height:1.35}

  .detalle p{margin:0 0 12px;font-size:14px;color:var(--body)}
  .detalle p span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;
    color:var(--mute);margin-bottom:3px;font-weight:600}
  code{font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:12.5px;
    background:var(--soft);padding:2px 7px;border-radius:6px;color:var(--ink)}

  label.obs{display:block;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
  label.obs span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;
    color:var(--mute);margin-bottom:7px;font-weight:600}
  textarea{width:100%;font:inherit;font-size:14px;padding:11px 13px;border:1px solid var(--line);
    border-radius:14px;background:var(--soft);color:var(--ink);resize:vertical}
  textarea:focus{outline:2px solid var(--sage);outline-offset:1px;background:#fff}

  .barra{position:fixed;left:0;right:0;bottom:0;background:rgba(255,255,255,.94);
    backdrop-filter:blur(12px);border-top:1px solid var(--line);padding:13px 20px}
  .barra .wrap{display:flex;align-items:center;gap:12px;padding:0}
  .barra p{margin:0;font-size:13px;color:var(--body);flex:1}
  button{font:inherit;font-size:14px;font-weight:600;padding:10px 22px;border-radius:999px;
    border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer}
  button.primario{background:var(--sage);border-color:var(--sage);color:#fff}
  button:disabled{opacity:.45;cursor:default}

  @media (max-width:720px){
    .aviso{grid-template-columns:1fr;gap:18px;padding:20px;border-radius:22px}
    .barra .wrap{flex-wrap:wrap} .barra p{flex-basis:100%}
  }
</style></head><body>

<div class="marca">
  <img src="/email/healthier-logo.png" alt="Healthier" width="118">
  <h1>Los avisos del teléfono</h1>
  <p>${tipos.length} notificaciones · para revisar qué dicen</p>
</div>

<header class="top"><div class="wrap"><nav>${nav}</nav></div></header>

<main class="wrap">
  <div class="intro">
    <p>Éstas son todas las notificaciones que Healthier le manda al teléfono de un paciente o de un profesional. Están como se ven de verdad: en la pantalla bloqueada.</p>
    <p>Un push se juzga distinto que un mail. Se lee <strong>de reojo y en dos segundos</strong>, muchas veces sin abrirlo, y el teléfono corta el título si es largo. Si hay que leerlo dos veces, no sirve.</p>
    <p>Si algo suena raro, escribilo en <strong>Observaciones</strong>. Se guardan en tu navegador; el botón de abajo te las copia todas juntas.</p>
    <p>Los textos de los mails están <a href="../emails/textos.html">acá al lado</a>.</p>
  </div>
  ${secciones}
</main>

<div class="barra"><div class="wrap">
  <p id="contador">Sin observaciones todavía.</p>
  <button type="button" id="limpiar">Borrar</button>
  <button type="button" id="copiar" class="primario">Copiar mis observaciones</button>
</div></div>

<script>
  const CLAVE = 'healthier-push-observaciones'
  const areas = [...document.querySelectorAll('textarea')]
  const contador = document.getElementById('contador')
  const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE) || '{}') } catch { return {} } }
  const guardar = o => { try { localStorage.setItem(CLAVE, JSON.stringify(o)) } catch {} }
  const conTexto = () => areas.filter(a => a.value.trim())

  function refrescar() {
    const n = conTexto().length
    contador.textContent = n === 0 ? 'Sin observaciones todavía.'
      : n + (n === 1 ? ' aviso con observaciones.' : ' avisos con observaciones.')
    document.getElementById('copiar').disabled = n === 0
    document.getElementById('limpiar').disabled = n === 0
  }
  const previas = leer()
  areas.forEach(a => {
    if (previas[a.dataset.slug]) a.value = previas[a.dataset.slug]
    a.addEventListener('input', () => {
      const o = leer()
      if (a.value.trim()) o[a.dataset.slug] = a.value; else delete o[a.dataset.slug]
      guardar(o); refrescar()
    })
  })
  refrescar()

  document.getElementById('copiar').addEventListener('click', async () => {
    const texto = 'Observaciones sobre los avisos push de Healthier\\n\\n' +
      conTexto().map(a => '— ' + a.dataset.titulo + '\\n' + a.value.trim()).join('\\n\\n')
    try { await navigator.clipboard.writeText(texto); contador.textContent = 'Copiado. Pegalo donde quieras.' }
    catch { window.prompt('Copiá esto:', texto) }
  })
  document.getElementById('limpiar').addEventListener('click', () => {
    if (!window.confirm('¿Borrar todas tus observaciones?')) return
    areas.forEach(a => { a.value = '' }); guardar({}); refrescar()
  })
</script>
</body></html>`)

console.log(`${tipos.length} avisos → ${join(OUT, 'textos.html')}`)
