/**
 * Previsualizador de los mails — `npm run emails`.
 *
 * Renderiza TODAS las plantillas con datos de ejemplo a `public/docs/emails/`,
 * o sea que se publican con el sitio: quedan en
 * `gethealthier.vercel.app/docs/emails/`. Existe porque un mail no se puede
 * revisar leyendo el HTML — los bloques se ven o no según el cliente, y el copy
 * se juzga mirándolo.
 *
 * Corre con tsx (Node), no con Deno: las plantillas no tocan la base ni la red,
 * reciben los datos ya masticados, así que se pueden importar tal cual.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as T from '../supabase/functions/_shared/email/templates.ts'

const OUT = join(import.meta.dirname, '..', 'public', 'docs', 'emails')
mkdirSync(OUT, { recursive: true })

const enHoras = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

const base: T.ConsultaBase = {
  id: '3f8c1a92-5d44-4e21-9c77-0a1b2c3d4e5f',
  scheduledAt: enHoras(26),
  modality: 'video',
  isOnDemand: false,
  vertical: 'clinica',
  priceAtBooking: 28000,
  patientName: 'Sofía',
  patientFullName: 'Sofía Ramírez',
  professionalName: 'Dra. Valentina Ortiz',
  professionalSpecialty: 'Medicina General',
  professionalAvatar: null,
  address: null,
}

const presencial: T.ConsultaBase = {
  ...base, modality: 'presencial',
  address: 'Av. Santa Fe 2450, piso 4 “B” — Recoleta, CABA',
}

const pedido: T.PedidoFarmacia = {
  id: '9b2e77c1-4a3f-4c8d-b1e6-77d0f9a1c2b3',
  patientName: 'Sofía',
  patientFullName: 'Sofía Ramírez',
  pharmacyName: 'Farmacia del Águila',
  deliveryAddress: 'Gorriti 4821, 2º A — Palermo, CABA',
  total: 31450,
  createdAt: new Date().toISOString(),
  items: [
    { nombre: 'Amoxicilina 500 mg — 21 comprimidos', cantidad: 1, precio: 18900 },
    { nombre: 'Ibuprofeno 400 mg — 20 comprimidos', cantidad: 2, precio: 6275 },
  ],
}

const post: T.PostConsulta = {
  ...base,
  scheduledAt: enHoras(-2),
  completedAt: enHoras(-1),
  closingNotes:
    'Cuadro compatible con faringitis bacteriana. Arrancá el antibiótico hoy mismo y completá los 7 días aunque te sientas mejor a los dos.\n\nSi a las 72 h seguís con fiebre por encima de 38 °C, escribime por la app antes de volver a consultar.',
  diagnosticos: [{ titulo: 'Faringitis aguda estreptocócica (J02.0)', nota: 'Confirmada por examen clínico.' }],
  indicaciones: [
    { titulo: 'Reposo relativo 48 h', detalle: 'Evitá esfuerzo físico hasta que baje la fiebre.' },
    { titulo: 'Hidratación abundante', detalle: '2 a 2,5 litros de agua por día.' },
    { titulo: 'Paracetamol 500 mg', detalle: 'Cada 8 h si hay dolor o fiebre · venta libre', nota: 'No pasar de 3 comprimidos por día.' },
  ],
  recetas: [
    { id: 'rx-1', medicamentos: ['Amoxicilina 500 mg', 'Ibuprofeno 400 mg'], pdfUrl: 'https://gethealthier.vercel.app/paciente/recetas' },
  ],
  yaCalificada: false,
}

type Caso = { slug: string; titulo: string; grupo: string; subject: string; html: string }
const authCaso = (slug: string, titulo: string, html: string, subject: string): Caso =>
  ({ slug, titulo, grupo: 'Cuenta y acceso', subject, html })
const caso = (slug: string, titulo: string, grupo: string, s: T.Sent): Caso =>
  ({ slug, titulo, grupo, subject: s.subject, html: s.html })

const CASOS: Caso[] = [
  authCaso('auth-confirmacion', 'Verificación de cuenta', T.authConfirmacion(), 'Confirmá tu correo · Healthier'),
  authCaso('auth-magic-link', 'Iniciar sesión (enlace mágico)', T.authMagicLink(), 'Entrá a tu cuenta de Healthier'),
  authCaso('auth-recuperacion', 'Recuperar contraseña', T.authRecuperacion(), 'Cambiá tu contraseña de Healthier'),
  authCaso('auth-codigo', 'Código de verificación', T.authCodigo(), 'Tu código de Healthier'),
  authCaso('auth-cambio-mail', 'Cambio de correo', T.authCambioDeMail(), 'Confirmá tu correo nuevo'),
  authCaso('auth-invitacion', 'Invitación', T.authInvitacion(), 'Te invitaron a Healthier'),
  caso('bienvenida', 'Bienvenida al paciente', 'Cuenta y acceso', T.bienvenidaPaciente({ name: 'Sofía Ramírez' })),

  caso('turno-video', 'Turno confirmado · video', 'Turnos', T.turnoConfirmadoPaciente(base)),
  caso('turno-presencial', 'Turno confirmado · presencial', 'Turnos', T.turnoConfirmadoPaciente(presencial)),
  caso('turno-profesional', 'Nueva reserva (al profesional)', 'Turnos', T.turnoConfirmadoProfesional(base)),
  caso('ondemand', 'Consulta inmediata confirmada', 'Turnos', T.ondemandConfirmadaPaciente({ ...base, isOnDemand: true, scheduledAt: null, waitMinutes: 4 })),
  caso('recordatorio-manana', 'Recordatorio · mañana', 'Turnos', T.recordatorioTurno({ ...base, cuando: 'manana' })),
  caso('recordatorio-pronto', 'Recordatorio · en 30 minutos', 'Turnos', T.recordatorioTurno({ ...base, scheduledAt: enHoras(0.5), cuando: 'pronto' })),
  caso('cancelada-paciente', 'Turno cancelado (al paciente)', 'Turnos', T.consultaCancelada({ ...base, paraQuien: 'paciente', motivo: 'El profesional tuvo una urgencia', canceladaPorMi: false })),
  caso('cancelada-profesional', 'Turno cancelado (al profesional)', 'Turnos', T.consultaCancelada({ ...base, paraQuien: 'profesional', motivo: null, canceladaPorMi: false })),

  caso('post-video', 'Post consulta · videoconsulta', 'Post consulta', T.postConsultaPaciente(post)),
  caso('post-presencial', 'Post consulta · presencial', 'Post consulta', T.postConsultaPaciente({ ...post, modality: 'presencial', address: presencial.address })),
  caso('post-ondemand', 'Post consulta · inmediata', 'Post consulta', T.postConsultaPaciente({ ...post, isOnDemand: true, scheduledAt: null })),
  caso('post-sin-receta', 'Post consulta · sin receta ni diagnóstico', 'Post consulta', T.postConsultaPaciente({ ...post, recetas: [], diagnosticos: [], indicaciones: [], closingNotes: null })),
  caso('receta-emitida', 'Receta electrónica emitida', 'Post consulta', T.recetaEmitida({
    patientName: 'Sofía',
  patientFullName: 'Sofía Ramírez', professionalName: 'Dra. Valentina Ortiz',
    medicamentos: ['Amoxicilina 500 mg — 21 comprimidos', 'Ibuprofeno 400 mg — 20 comprimidos'],
    pdfUrl: 'https://gethealthier.vercel.app/paciente/recetas', prescriptionId: 'rx-1',
  })),

  caso('farmacia-confirmado', 'Pedido de farmacia confirmado', 'Farmacia', T.pedidoFarmaciaConfirmado(pedido)),
  caso('farmacia-preparacion', 'Pedido en preparación', 'Farmacia', T.pedidoFarmaciaEstado({ ...pedido, estado: 'en_preparacion' })),
  caso('farmacia-enviado', 'Pedido en camino', 'Farmacia', T.pedidoFarmaciaEstado({ ...pedido, estado: 'enviado' })),
  caso('farmacia-entregado', 'Pedido entregado', 'Farmacia', T.pedidoFarmaciaEstado({ ...pedido, estado: 'entregado' })),
  caso('farmacia-cancelado', 'Pedido cancelado', 'Farmacia', T.pedidoFarmaciaEstado({ ...pedido, estado: 'cancelado', motivo: 'La farmacia no tenía stock del antibiótico' })),

  caso('pro-verificado', 'Profesional verificado', 'Profesionales', T.profesionalVerificado({ name: 'Dra. Valentina Ortiz' })),
  caso('pro-observado', 'Documentación con observaciones', 'Profesionales', T.profesionalObservado({ name: 'Dra. Valentina Ortiz', motivo: 'La foto del título se ve cortada: falta el número de matrícula del margen inferior.' })),
]

// El logo se sirve desde `APP_URL`, que en la preview todavía no existe: se
// copia al lado de los HTML y se reescribe la ruta, así se ve sin deployar.
copyFileSync(join(import.meta.dirname, '..', 'public', 'email', 'healthier-logo.png'), join(OUT, 'healthier-logo.png'))
const local = (html: string) => html.replace(/https?:\/\/[^"']*\/email\/healthier-logo\.png/g, 'healthier-logo.png')

for (const c of CASOS) writeFileSync(join(OUT, `${c.slug}.html`), local(c.html))

// ── Índice ───────────────────────────────────────────────────────────────────
const grupos = [...new Set(CASOS.map(c => c.grupo))]
const nav = grupos.map(g => `
  <section>
    <h2>${g}</h2>
    ${CASOS.filter(c => c.grupo === g).map(c => `
      <button type="button" data-src="${c.slug}.html" data-subject="${c.subject.replace(/"/g, '&quot;')}">
        <span>${c.titulo}</span><small>${c.subject}</small>
      </button>`).join('')}
  </section>`).join('')

writeFileSync(join(OUT, 'index.html'), `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mails de Healthier</title>
<style>
  :root{--ink:#2D2A26;--body:#6B6560;--mute:#A8A29E;--line:#E7E3DC;--page:#F6F5F0;--sage:#7CB38B}
  *{box-sizing:border-box}
  body{margin:0;display:flex;height:100dvh;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--ink);background:var(--page)}
  aside{width:310px;flex:none;overflow:auto;background:#fff;border-right:1px solid var(--line);padding:20px 16px 40px}
  aside h1{font-size:17px;margin:0 0 4px}
  aside p.sub{margin:0 0 20px;font-size:12px;color:var(--mute)}
  aside h2{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--mute);margin:22px 0 8px}
  button{display:block;width:100%;text-align:left;background:none;border:0;border-radius:11px;padding:9px 11px;cursor:pointer;font:inherit;color:inherit}
  button:hover{background:#FAF9F5}
  button[aria-current=true]{background:#EDF4EF}
  button span{display:block;font-weight:600;font-size:13.5px}
  button small{display:block;color:var(--mute);font-size:11.5px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  main{flex:1;display:flex;flex-direction:column;min-width:0}
  header{padding:14px 20px;border-bottom:1px solid var(--line);background:#fff;display:flex;align-items:center;gap:14px}
  header b{font-size:13px}
  header .w{margin-left:auto;display:flex;gap:6px}
  header .w button{width:auto;padding:6px 13px;border:1px solid var(--line);border-radius:999px;font-size:12px;font-weight:600}
  header .w button[aria-current=true]{background:var(--sage);color:#fff;border-color:var(--sage)}
  .stage{flex:1;overflow:auto;display:flex;justify-content:center;padding:26px 0}
  iframe{border:0;background:#F6F5F0;width:680px;height:100%;transition:width .18s}
  iframe.mobile{width:390px}
</style></head><body>
<aside>
  <h1>Mails de Healthier</h1>
  <p class="sub">${CASOS.length} plantillas · datos de ejemplo</p>
  ${nav}
</aside>
<main>
  <header><b id="subject">—</b>
    <span class="w">
      <button type="button" id="w-desktop" aria-current="true">Escritorio</button>
      <button type="button" id="w-mobile">Teléfono</button>
    </span>
  </header>
  <div class="stage"><iframe id="v" title="Vista previa"></iframe></div>
</main>
<script>
  const v = document.getElementById('v'), subject = document.getElementById('subject')
  const items = [...document.querySelectorAll('aside button')]
  function show(b){ items.forEach(x => x.setAttribute('aria-current', String(x === b)))
    v.src = b.dataset.src; subject.textContent = b.dataset.subject }
  items.forEach(b => b.addEventListener('click', () => show(b)))
  show(items[0])
  const d = document.getElementById('w-desktop'), m = document.getElementById('w-mobile')
  d.onclick = () => { v.classList.remove('mobile'); d.setAttribute('aria-current','true'); m.setAttribute('aria-current','false') }
  m.onclick = () => { v.classList.add('mobile'); m.setAttribute('aria-current','true'); d.setAttribute('aria-current','false') }
</script>
</body></html>`)

console.log(`${CASOS.length} plantillas → ${join(OUT, 'index.html')}`)
