/**
 * Genera la plantilla de Healthier lista para pegar en Customer.io — `npm run emails`.
 *
 * Por qué existe: Hyppo arma sus campañas en Customer.io y, si copian el diseño
 * a ojo, en dos meses hay dos Healthier distintos en la bandeja del paciente.
 * Esto sale del MISMO `layout.ts` y `theme.ts` que los mails de la plataforma,
 * así que no puede quedar desfasado: si cambia la paleta, cambia acá solo.
 *
 * Deja dos archivos en `public/docs/emails/`, o sea publicados con el sitio:
 *  · `customerio-plantilla.html` — el HTML pelado, con variables de Liquid.
 *  · `customerio.html` — la guía: qué es cada bloque, los cuatro acentos y el
 *    bloque para copiar.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACCENTS, APP_URL, C, FONT, type Accent } from '../supabase/functions/_shared/email/theme.ts'
import { button, esc, link, note, p, panel, personCard, renderEmail } from '../supabase/functions/_shared/email/layout.ts'

const OUT = join(import.meta.dirname, '..', 'public', 'docs', 'emails')
mkdirSync(OUT, { recursive: true })

/** Las variables de Liquid que usa la plantilla, con qué son. */
const VARIABLES: Array<{ v: string; que: string }> = [
  { v: '{{customer.first_name}}', que: 'Nombre de pila de la persona' },
  { v: '{{event.professional_name}}', que: 'Nombre del profesional' },
  { v: '{{event.specialty}}', que: 'Especialidad, debajo del nombre' },
  { v: '{{event.date}}', que: 'Fecha del turno, ya formateada' },
  { v: '{{event.time}}', que: 'Hora del turno' },
  { v: '{{event.modality}}', que: '"Videoconsulta" o "Presencial"' },
  { v: '{{event.cta_url}}', que: 'A dónde lleva el botón' },
  { v: '{{event.professional_name | slice: 0 | upcase}}', que: 'La inicial del círculo, si no hay foto' },
]

const PLANTILLA = renderEmail({
  preheader: 'Este renglón es lo que se ve al lado del asunto en la bandeja — escribirlo siempre',
  eyebrow: 'Etiqueta opcional',
  title: 'El título del mail, en una línea',
  accent: 'sage',
  body: [
    p(`Hola <strong style="color:${C.ink}">{{customer.first_name}}</strong>, acá va el primer párrafo. Una o dos frases, sin vueltas.`),
    personCard({ name: '{{event.professional_name}}', subtitle: '{{event.specialty}}', accent: 'sage' }),
    panel([
      { label: 'Cuándo', value: '{{event.date}} · {{event.time}}' },
      { label: 'Modalidad', value: '{{event.modality}}' },
    ], 'sage'),
    note('El recuadro de aviso, para lo que la persona tiene que hacer o saber antes.', 'sage'),
    button('{{event.cta_url}}', 'La acción principal', 'sage'),
    link(`${APP_URL}/paciente/consultas`, 'Un enlace secundario, debajo del botón'),
  ].join(''),
  footnote: 'El renglón chico del final, dentro de la tarjeta.',
})

// La inicial del avatar la calcula nuestro código a partir del nombre; acá el
// nombre es una variable de Liquid, así que saldría la llave literal ("{").
// En Customer.io el HTML es estático, o sea que la inicial también tiene que
// resolverla Liquid.
const PLANTILLA_CIO = PLANTILLA.replace(
  '>{</td>',
  '>{{event.professional_name | slice: 0 | upcase}}</td>',
)

writeFileSync(join(OUT, 'customerio-plantilla.html'), PLANTILLA_CIO)

// ── La guía ──────────────────────────────────────────────────────────────────

const swatch = (nombre: Accent, cuando: string) => {
  const a = ACCENTS[nombre]
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid ${C.line}">
      <span style="display:inline-block;width:18px;height:18px;border-radius:9px;background:${a.base};vertical-align:middle"></span>
      <strong style="margin-left:8px">${nombre}</strong>
    </td>
    <td style="padding:10px 0;border-bottom:1px solid ${C.line};color:${C.body}">${cuando}</td>
    <td style="padding:10px 0;border-bottom:1px solid ${C.line};font-family:ui-monospace,monospace;font-size:13px;color:${C.body}">
      ${a.base} · ${a.ink} · ${a.soft}
    </td>
  </tr>`
}

const bloque = (nombre: string, que: string) =>
  `<tr><td style="padding:9px 0;border-bottom:1px solid ${C.line}"><strong>${nombre}</strong></td>
       <td style="padding:9px 0;border-bottom:1px solid ${C.line};color:${C.body}">${que}</td></tr>`

const guia = `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Healthier — plantilla de mails para Customer.io</title>
<style>
  :root { color-scheme: light }
  body { margin:0; background:${C.page}; color:${C.ink}; font-family:${FONT}; line-height:1.6 }
  .wrap { max-width:940px; margin:0 auto; padding:48px 20px 80px }
  h1 { font-size:30px; line-height:1.2; letter-spacing:-.4px; margin:0 0 10px }
  h2 { font-size:19px; margin:44px 0 12px; letter-spacing:-.2px }
  p, li { color:${C.body}; font-size:15px }
  strong { color:${C.ink} }
  table { width:100%; border-collapse:collapse; font-size:15px }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13.5px;
         background:${C.soft}; border:1px solid ${C.line}; border-radius:6px; padding:1px 5px }
  .card { background:${C.card}; border:1px solid ${C.line}; border-radius:18px; padding:22px 24px; margin:0 0 20px }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:20px; align-items:start }
  @media (max-width:760px) { .grid { grid-template-columns:1fr } }
  iframe { width:100%; height:760px; border:1px solid ${C.line}; border-radius:18px; background:#fff }
  pre { margin:0; padding:16px; background:${C.ink}; color:#EDEAE4; border-radius:14px;
        overflow:auto; max-height:420px; font-size:12px; line-height:1.5 }
  .btn { display:inline-block; background:${C.sage}; color:#fff; border:0; border-radius:999px;
         padding:10px 18px; font-size:14px; font-weight:600; cursor:pointer; font-family:inherit }
  .muted { color:${C.mute}; font-size:13px }
</style>
</head>
<body>
<div class="wrap">

  <p class="muted" style="text-transform:uppercase;letter-spacing:.09em;font-weight:700">Healthier · para Hyppo</p>
  <h1>La plantilla de mails, para replicar en Customer.io</h1>
  <p style="max-width:62ch">Este es el mismo armazón con el que Healthier manda hoy sus mails
  transaccionales. Se genera desde el código de la plataforma, así que si cambia la
  paleta o el pie, esta página cambia sola.</p>

  <h2>1 · Cómo se ve</h2>
  <div class="grid">
    <iframe src="customerio-plantilla.html" title="Vista previa de la plantilla"></iframe>
    <div>
      <div class="card">
        <p style="margin:0 0 10px"><strong>Las reglas que no se negocian.</strong></p>
        <ul style="margin:0;padding-left:18px">
          <li>Tablas, nunca flex ni grid — Outlook renderiza con Word y desarma todo lo moderno.</li>
          <li>Estilos inline. Gmail borra el <code>&lt;style&gt;</code> del head en varias vistas.</li>
          <li>Ancho 600px, una sola columna: se lee igual en el teléfono, que es donde se abre.</li>
          <li>El <strong>preheader</strong> oculto va siempre. Es el renglón gris que Gmail muestra al lado del asunto; si no se escribe, muestra el principio del HTML.</li>
          <li>Tipografía del sistema. General Sans y Everett son webfonts propias y ningún cliente de mail las carga.</li>
        </ul>
      </div>
      <div class="card">
        <p style="margin:0 0 10px"><strong>Variables</strong></p>
        <table>
          ${VARIABLES.map(x => `<tr>
            <td style="padding:7px 0;border-bottom:1px solid ${C.line}"><code>${esc(x.v)}</code></td>
            <td style="padding:7px 0;border-bottom:1px solid ${C.line};color:${C.body}">${x.que}</td>
          </tr>`).join('')}
        </table>
        <p class="muted" style="margin:12px 0 0">Los nombres son de ejemplo: lo importante es
        dónde va cada dato. Reemplácenlos por los suyos.</p>
      </div>
    </div>
  </div>

  <h2>2 · Los cuatro acentos</h2>
  <p style="max-width:62ch">El color cambia según la vertical de la consulta. Es lo único que
  cambia: el resto del mail es idéntico. Cada acento son tres valores — el fuerte (botón y
  puntos), el oscuro (texto sobre el suave) y el suave (fondos de bloque).</p>
  <div class="card">
    <table>
      <tr><th align="left" style="padding-bottom:8px">Acento</th>
          <th align="left" style="padding-bottom:8px">Cuándo</th>
          <th align="left" style="padding-bottom:8px">Fuerte · Oscuro · Suave</th></tr>
      ${swatch('sage', 'Clínica médica y entrenamiento físico. Es el que va por defecto.')}
      ${swatch('amber', 'Nutrición')}
      ${swatch('lavender', 'Salud mental')}
      ${swatch('coral', 'Veterinaria')}
    </table>
  </div>

  <h2>3 · Los bloques</h2>
  <p style="max-width:62ch">El cuerpo se arma apilando estos bloques. No hace falta usarlos todos
  ni respetar el orden, pero conviene no inventar otros.</p>
  <div class="card">
    <table>
      ${bloque('Etiqueta', 'La píldora chica arriba del título. Opcional.')}
      ${bloque('Título', 'Una línea. Dice qué pasó, no cómo se llama el mail.')}
      ${bloque('Párrafo', 'Una o dos frases. El nombre de la persona va en negrita.')}
      ${bloque('Tarjeta de persona', 'Foto o inicial + nombre + especialidad. Para el profesional.')}
      ${bloque('Panel de datos', 'Los datos duros en pares etiqueta/valor: cuándo, modalidad, precio.')}
      ${bloque('Aviso', 'Recuadro con fondo del acento, para lo que hay que hacer o saber.')}
      ${bloque('Botón', 'Uno solo por mail, la acción principal.')}
      ${bloque('Enlace secundario', 'Debajo del botón, en gris.')}
      ${bloque('Pie', 'Mi cuenta · Mis consultas · Términos · WhatsApp, y el motivo del envío. Va siempre.')}
    </table>
  </div>

  <h2>4 · El HTML</h2>
  <p style="max-width:62ch">Pegar tal cual en el editor de código de Customer.io y reemplazar el
  texto. <a href="customerio-plantilla.html">También se puede abrir suelto</a>.</p>
  <p><button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('codigo').textContent).then(()=>{this.textContent='Copiado'})">Copiar el HTML</button></p>
  <pre id="codigo">${esc(PLANTILLA_CIO)}</pre>

  <h2>5 · Lo que conviene cruzar antes</h2>
  <div class="card">
    <p style="margin:0">Healthier ya manda desde <code>healthier.com.ar</code> la bienvenida, la
    confirmación de turno y dos recordatorios. Son los tres que se cruzan con las campañas que
    están armando: si los mandamos los dos, la persona recibe todo dos veces. Conviene definir
    quién manda cada uno antes de prender nada.</p>
  </div>

  <p class="muted" style="margin-top:44px">Healthier · Preparado por Marco Polo</p>
</div>
</body></html>`

writeFileSync(join(OUT, 'customerio.html'), guia)

console.log('plantilla para Customer.io')
console.log(`  guía     → ${join(OUT, 'customerio.html')}`)
console.log(`  plantilla → ${join(OUT, 'customerio-plantilla.html')}`)
