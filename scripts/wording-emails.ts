/**
 * La página de revisión de textos — `npm run emails` la genera junto con la de
 * diseño y queda publicada en `/docs/emails/textos.html`.
 *
 * Para qué existe y en qué se diferencia de `index.html`: aquélla sirve para
 * mirar cómo se ve el mail; ésta para **leer lo que dice**. El equipo de
 * Healthier revisa el copy, no el diseño, y en la vista maquetada el texto
 * compite con el color, los bloques y el botón. Acá está todo plano, en orden,
 * con el asunto y el preheader arriba de cada uno — que son las dos líneas que
 * más se leen y las que nunca se revisan.
 *
 * No pide login: es un HTML estático que se publica con el sitio.
 *
 * Las observaciones se escriben en la misma página y se guardan en el navegador
 * de cada uno (`localStorage`), con un botón que las copia todas juntas. No hay
 * backend a propósito: montar uno para recibir comentarios de cinco personas es
 * más trabajo del que ahorra, y obligaría a exponer una escritura pública en la
 * base de una plataforma de salud.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type CasoTexto = { slug: string; titulo: string; grupo: string; subject: string; html: string }

const ENTIDADES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ',
  '&#8199;': '', '&#65279;': '', '&#847;': '',
}

/**
 * Los marcadores que rellena Supabase Auth (`{{ .ConfirmationURL }}`) no son
 * copy: mostrarlos crudos hace que el que revisa se detenga en algo que no
 * puede cambiar. Se muestran por lo que son.
 */
const PLACEHOLDERS: Array<[RegExp, string]> = [
  [/\{\{\s*\.ConfirmationURL\s*\}\}/g, '[acá va el enlace]'],
  [/\{\{\s*\.Token\s*\}\}/g, '[acá va el código]'],
  [/\{\{\s*\.NewEmail\s*\}\}/g, '[el correo nuevo]'],
  [/\{\{\s*\.Email\s*\}\}/g, '[el correo actual]'],
  [/\{\{\s*\.SiteURL\s*\}\}/g, '[la dirección del sitio]'],
]

/** El texto que va DENTRO de un botón o de un enlace: se marca aparte. */
function acciones(html: string): Set<string> {
  const out = new Set<string>()
  for (const m of html.matchAll(/<a[^>]*display:inline-block[^>]*>([\s\S]*?)<\/a>/g)) out.add(limpiar(m[1]))
  for (const m of html.matchAll(/<a[^>]*text-decoration:underline[^>]*>([\s\S]*?)<\/a>/g)) out.add(limpiar(m[1]))
  out.delete('')
  return out
}

/**
 * Los renglones en mayúsculas: los títulos de sección ("Indicaciones") y las
 * etiquetas de cada dato ("Cuándo", "Con quién"). Son copy que se revisa, pero
 * leerlos como si fueran párrafos hace perder la estructura del mail.
 */
function etiquetas(html: string): Set<string> {
  const out = new Set<string>()
  for (const m of html.matchAll(/<p[^>]*text-transform:uppercase[^>]*>([\s\S]*?)<\/p>/g)) out.add(limpiar(m[1]))
  out.delete('')
  return out
}

function eyebrowDe(html: string): string {
  const m = html.match(/border-radius:999px;padding:6px 13px[^>]*>([\s\S]*?)<\/td>/)
  return m ? limpiar(m[1]) : ''
}

function tituloDe(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
  return m ? limpiar(m[1]) : ''
}

function limpiar(s: string): string {
  let t = s.replace(/<[^>]+>/g, '').replace(/&#?\w+;/g, e => ENTIDADES[e] ?? e)
  for (const [re, txt] of PLACEHOLDERS) t = t.replace(re, txt)
  return t.replace(/\s+/g, ' ').trim()
}

/** Saca el texto legible de un mail, respetando los cortes de bloque. */
function aTexto(html: string): string[] {
  // El preheader y el relleno invisible no son copy que se revise acá: se ven
  // arriba, en su propio campo.
  const cuerpo = html
    .replace(/<div style="display:none[\s\S]*?<\/div>/g, '')
    .replace(/<!doctype[\s\S]*?<body[^>]*>/i, '')

  return cuerpo
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|td|tr|table|div|a)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map(l => limpiar(l))
    // La inicial suelta es el círculo que reemplaza a la foto cuando no hay
    // avatar: no es texto que alguien tenga que revisar.
    .filter(l => l.length > 1)
}

function preheaderDe(html: string): string {
  const m = html.match(/<div style="display:none;font-size:1px[^>]*>([\s\S]*?)<\/div>/)
  return m ? limpiar(m[1]) : ''
}

const esc = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export function generarPaginaDeTextos(CASOS: CasoTexto[], OUT: string) {
  const grupos = [...new Set(CASOS.map(c => c.grupo))]

  const secciones = grupos.map(g => `
  <section class="grupo">
    <h2 id="g-${esc(g).replace(/\s+/g, '-').toLowerCase()}">${esc(g)}</h2>
    ${CASOS.filter(c => c.grupo === g).map(c => {
      const lineas = aTexto(c.html)
      // El pie es igual en los 27; se muestra una vez al final, no 27 veces.
      const corte = lineas.findIndex(l => l.startsWith('Mi cuenta'))
      const cuerpo = corte === -1 ? lineas : lineas.slice(0, corte)
      // El chip, el título y lo que dice cada botón se leen distinto que el
      // cuerpo: si van todos como párrafos, un botón parece una frase suelta.
      const chip = eyebrowDe(c.html)
      const titulo = tituloDe(c.html)
      const acc = acciones(c.html)
      const etq = etiquetas(c.html)
      const clase = (l: string) =>
        l === chip ? 'chip'
        : l === titulo ? 'titulo'
        : acc.has(l) ? 'accion'
        : etq.has(l) ? 'etiqueta' : ''
      return `
    <article class="mail" id="${esc(c.slug)}">
      <header>
        <h3>${esc(c.titulo)}</h3>
        <a class="ver" href="index.html#${esc(c.slug)}" target="_blank" rel="noopener">Ver el diseño ↗</a>
      </header>
      <dl class="meta">
        <dt>Asunto</dt><dd class="destacado">${esc(c.subject)}</dd>
        <dt>Vista previa <span title="El renglón gris que Gmail muestra al lado del asunto">(?)</span></dt>
        <dd>${esc(preheaderDe(c.html))}</dd>
      </dl>
      <div class="cuerpo">${cuerpo.map(l => {
        const k = clase(l)
        return `<p${k ? ` class="${k}"` : ''}>${esc(l)}</p>`
      }).join('')}</div>
      <label class="obs">
        <span>Observaciones</span>
        <textarea data-slug="${esc(c.slug)}" data-titulo="${esc(c.titulo)}"
                  rows="2" placeholder="Qué cambiarías de este texto…"></textarea>
      </label>
    </article>`
    }).join('')}
  </section>`).join('')

  const nav = grupos.map(g =>
    `<a href="#g-${esc(g).replace(/\s+/g, '-').toLowerCase()}">${esc(g)}</a>`).join('')

  writeFileSync(join(OUT, 'textos.html'), `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Los textos de los mails de Healthier</title>
<meta name="description" content="Los ${CASOS.length} mails que manda Healthier, en texto, para revisar el copy.">
<style>
  :root{
    --ink:#2D2A26; --body:#6B6560; --mute:#A8A29E; --line:#E7E3DC;
    --page:#F6F5F0; --card:#fff; --soft:#FAF9F5; --sage:#7CB38B; --sage-ink:#3F6B4C; --sage-soft:#EDF4EF;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--page);color:var(--ink);
    font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,'Helvetica Neue',Arial,sans-serif}
  header.top{position:sticky;top:0;z-index:10;background:rgba(246,245,240,.92);
    backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
  .wrap{max-width:760px;margin:0 auto;padding:0 20px}
  header.top .wrap{padding-top:16px;padding-bottom:14px}
  h1{margin:0;font-size:19px;letter-spacing:-.2px}
  .sub{margin:4px 0 0;font-size:14px;color:var(--body)}
  nav{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
  nav a{font-size:12.5px;font-weight:600;color:var(--sage-ink);background:var(--sage-soft);
    padding:5px 11px;border-radius:999px;text-decoration:none}
  nav a:hover{background:#e2eee7}
  main{padding:28px 0 80px}
  .intro{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px 20px;margin-bottom:32px}
  .intro p{margin:0 0 8px;font-size:14.5px;color:var(--body)}
  .intro p:last-child{margin:0}
  .ej-chip{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;
    color:var(--sage-ink);background:var(--sage-soft);padding:3px 8px;border-radius:999px}
  .ej-accion{font-size:12.5px;font-weight:600;color:var(--sage-ink);border:1px dashed #c9ddd0;
    border-radius:999px;padding:2px 9px}
  .grupo h2{margin:34px 0 14px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute)}
  .mail{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px 22px;margin-bottom:14px}
  .mail header{display:flex;align-items:baseline;gap:12px;margin-bottom:14px}
  .mail h3{margin:0;font-size:17px;letter-spacing:-.2px;flex:1}
  .ver{font-size:12.5px;color:var(--mute);text-decoration:none;white-space:nowrap}
  .ver:hover{color:var(--sage-ink);text-decoration:underline}
  dl.meta{margin:0 0 16px;padding:14px 16px;background:var(--soft);border-radius:12px;
    display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:14px}
  dl.meta dt{color:var(--mute);font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;padding-top:3px}
  dl.meta dd{margin:0;color:var(--body)}
  dl.meta dd.destacado{color:var(--ink);font-weight:600}
  dl.meta span{cursor:help}
  .cuerpo p{margin:0 0 9px;font-size:15px;color:var(--ink)}
  .cuerpo p:last-child{margin:0}
  .cuerpo p.chip{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.09em;
    text-transform:uppercase;color:var(--sage-ink);background:var(--sage-soft);
    padding:4px 10px;border-radius:999px;margin-bottom:10px}
  .cuerpo p.titulo{font-size:20px;font-weight:600;letter-spacing:-.3px;margin-bottom:12px}
  .cuerpo p.accion{display:inline-block;font-size:13.5px;font-weight:600;color:var(--sage-ink);
    border:1px dashed #c9ddd0;border-radius:999px;padding:4px 13px;margin:2px 6px 8px 0}
  .cuerpo p.accion::before{content:'botón · ';color:var(--mute);font-weight:400}
  .cuerpo p.etiqueta{font-size:11.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;
    color:var(--mute);margin:14px 0 5px}
  label.obs{display:block;margin-top:16px;padding-top:14px;border-top:1px dashed var(--line)}
  label.obs span{display:block;font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);margin-bottom:6px}
  textarea{width:100%;font:inherit;font-size:14px;padding:9px 11px;border:1px solid var(--line);
    border-radius:10px;background:var(--soft);color:var(--ink);resize:vertical}
  textarea:focus{outline:2px solid var(--sage);outline-offset:1px;background:#fff}
  .barra{position:fixed;left:0;right:0;bottom:0;background:rgba(255,255,255,.94);
    backdrop-filter:blur(12px);border-top:1px solid var(--line);padding:12px 20px}
  .barra .wrap{display:flex;align-items:center;gap:12px;padding:0}
  .barra p{margin:0;font-size:13px;color:var(--body);flex:1}
  button{font:inherit;font-size:14px;font-weight:600;padding:9px 18px;border-radius:999px;
    border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer}
  button.primario{background:var(--sage);border-color:var(--sage);color:#fff}
  button:disabled{opacity:.45;cursor:default}
  footer{color:var(--mute);font-size:13px;padding:0 0 40px}
  @media (max-width:640px){ .barra .wrap{flex-wrap:wrap} .barra p{flex-basis:100%} }
</style></head><body>

<header class="top"><div class="wrap">
  <h1>Los textos de los mails de Healthier</h1>
  <p class="sub">${CASOS.length} mails · para revisar qué dicen, no cómo se ven</p>
  <nav>${nav}</nav>
</div></header>

<main class="wrap">
  <div class="intro">
    <p>Éstos son todos los mails que Healthier le manda a un paciente o a un profesional. Están en texto plano y en el mismo orden en que aparecen en el mail.</p>
    <p>Si algo suena raro, escribilo en <strong>Observaciones</strong>, debajo de cada uno. Se guardan en tu navegador mientras revisás; cuando termines, el botón de abajo te las copia todas juntas para pegarlas donde quieras.</p>
    <p>Dos cosas que conviene mirar y que se suelen pasar por alto: el <strong>asunto</strong>, que es lo único que se ve en la bandeja, y la <strong>vista previa</strong>, el renglón gris que Gmail muestra al lado.</p>
    <p>Lo que aparece <span class="ej-chip">así</span> es la etiqueta de arriba, y lo que aparece <span class="ej-accion">botón · así</span> es el texto de un botón o de un enlace. Los <em>[corchetes]</em> son datos que completa el sistema.</p>
  </div>
  ${secciones}

  <footer>
    <p>Todos los mails terminan con el mismo pie: <em>Mi cuenta · Mis consultas · Términos — Healthier · Buenos Aires, Argentina. Recibís este mail porque tenés una cuenta en Healthier.</em></p>
  </footer>
</main>

<div class="barra"><div class="wrap">
  <p id="contador">Sin observaciones todavía.</p>
  <button type="button" id="limpiar">Borrar</button>
  <button type="button" id="copiar" class="primario">Copiar mis observaciones</button>
</div></div>

<script>
  const CLAVE = 'healthier-textos-observaciones'
  const areas = [...document.querySelectorAll('textarea')]
  const contador = document.getElementById('contador')

  const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE) || '{}') } catch { return {} } }
  const guardar = o => { try { localStorage.setItem(CLAVE, JSON.stringify(o)) } catch {} }

  const conTexto = () => areas.filter(a => a.value.trim())
  function refrescar() {
    const n = conTexto().length
    contador.textContent = n === 0 ? 'Sin observaciones todavía.'
      : n + (n === 1 ? ' mail con observaciones.' : ' mails con observaciones.')
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
    const texto = 'Observaciones sobre los textos de los mails de Healthier\\n\\n' +
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

  return CASOS.length
}
