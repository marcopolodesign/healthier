/**
 * El armazón de todos los mails de Healthier.
 *
 * Reglas que no se negocian (y por qué):
 *  · **Tablas, no flex/grid.** Outlook renderiza con Word; cualquier layout
 *    moderno se le desarma.
 *  · **Estilos inline.** Gmail borra el `<style>` del head en varias vistas.
 *    (Es la única excepción a la regla de "nada de inline styles" del front.)
 *  · **Ancho 600px** y todo apilado en una columna: así se ve igual en el
 *    teléfono, que es donde se leen.
 *  · **Preheader oculto**: el renglón gris que Gmail muestra al lado del asunto.
 *    Si no se escribe, muestra el principio del HTML — casi siempre basura.
 */
import { ACCENTS, APP_URL, C, FONT, LOGO_URL, type Accent } from './theme.ts'

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ── Bloques ──────────────────────────────────────────────────────────────────

/** Tarjeta interior: el dato duro del mail (cuándo, con quién, cuánto). */
export function panel(rows: Array<{ label: string; value: string }>, accent: Accent = 'sage') {
  const a = ACCENTS[accent]
  const cells = rows.map((r, i) => `
    <tr>
      <td style="padding:${i === 0 ? '0' : '14px'} 0 0 0">
        <p style="margin:0 0 3px;font-size:11px;line-height:1.4;letter-spacing:.08em;text-transform:uppercase;color:${C.mute};font-family:${FONT}">${esc(r.label)}</p>
        <p style="margin:0;font-size:16px;line-height:1.45;color:${C.ink};font-weight:600;font-family:${FONT}">${r.value}</p>
      </td>
    </tr>`).join('')

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:${a.soft};border-radius:18px;margin:0 0 24px">
    <tr><td style="padding:22px 24px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cells}</table>
    </td></tr>
  </table>`
}

/** Quién te atendió / quién te reservó — foto + nombre + especialidad. */
export function personCard(opts: { name: string; subtitle?: string | null; avatarUrl?: string | null; note?: string | null; accent?: Accent }) {
  const a = ACCENTS[opts.accent ?? 'sage']
  const initial = esc((opts.name || '?').trim().charAt(0).toUpperCase())
  const avatar = opts.avatarUrl
    ? `<img src="${esc(opts.avatarUrl)}" width="52" height="52" alt="" style="display:block;width:52px;height:52px;border-radius:26px;object-fit:cover;border:0">`
    : `<table role="presentation" width="52" height="52" cellpadding="0" cellspacing="0" border="0" style="background:${a.soft};border-radius:26px">
         <tr><td align="center" valign="middle" style="height:52px;font-family:${FONT};font-size:20px;font-weight:700;color:${a.ink}">${initial}</td></tr>
       </table>`

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="border:1px solid ${C.line};border-radius:18px;margin:0 0 24px">
    <tr><td style="padding:16px 18px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="52" valign="top">${avatar}</td>
          <td width="14"></td>
          <td valign="middle">
            <p style="margin:0;font-size:16px;line-height:1.35;font-weight:600;color:${C.ink};font-family:${FONT}">${esc(opts.name)}</p>
            ${opts.subtitle ? `<p style="margin:2px 0 0;font-size:13px;line-height:1.4;color:${C.body};font-family:${FONT}">${esc(opts.subtitle)}</p>` : ''}
            ${opts.note ? `<p style="margin:5px 0 0;font-size:12px;line-height:1.4;font-weight:600;color:${a.ink};font-family:${FONT}">${esc(opts.note)}</p>` : ''}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>`
}

/** Lista de ítems con título y detalle: indicaciones, recetas, medicamentos. */
export function itemList(title: string, items: Array<{ title: string; detail?: string | null; note?: string | null; href?: string | null; hrefLabel?: string }>, accent: Accent = 'sage') {
  if (!items.length) return ''
  const a = ACCENTS[accent]
  const rows = items.map(it => `
    <tr><td style="padding:0 0 10px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.soft};border:1px solid ${C.line};border-radius:14px">
        <tr><td style="padding:14px 16px">
          <p style="margin:0;font-size:15px;line-height:1.4;font-weight:600;color:${C.ink};font-family:${FONT}">${esc(it.title)}</p>
          ${it.detail ? `<p style="margin:3px 0 0;font-size:13px;line-height:1.5;color:${C.body};font-family:${FONT}">${esc(it.detail)}</p>` : ''}
          ${it.note ? `<p style="margin:3px 0 0;font-size:13px;line-height:1.5;color:${C.body};font-family:${FONT}">${esc(it.note)}</p>` : ''}
          ${it.href ? `<p style="margin:9px 0 0"><a href="${esc(it.href)}" style="font-size:13px;font-weight:600;color:${a.ink};font-family:${FONT};text-decoration:underline">${esc(it.hrefLabel ?? 'Ver')} →</a></p>` : ''}
        </td></tr>
      </table>
    </td></tr>`).join('')

  return `
  <p style="margin:0 0 10px;font-size:13px;line-height:1.4;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${C.mute};font-family:${FONT}">${esc(title)}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px">${rows}</table>`
}

/** Párrafo de cuerpo. */
export function p(html: string) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:${C.body};font-family:${FONT}">${html}</p>`
}

/** Bloque de texto tal cual lo escribió el profesional (resumen, notas). */
export function quote(text: string) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.soft};border:1px solid ${C.line};border-radius:16px;margin:0 0 24px">
    <tr><td style="padding:18px 20px">
      <p style="margin:0;font-size:14px;line-height:1.65;color:${C.ink};font-family:${FONT};white-space:pre-wrap">${esc(text)}</p>
    </td></tr>
  </table>`
}

/** Aviso chico al pie del cuerpo — el "ojo con esto". */
export function note(text: string, accent: Accent = 'amber') {
  const a = ACCENTS[accent]
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${a.soft};border-radius:14px;margin:0 0 22px">
    <tr><td style="padding:14px 16px">
      <p style="margin:0;font-size:13px;line-height:1.55;color:${a.ink};font-family:${FONT}">${text}</p>
    </td></tr>
  </table>`
}

/** Botón pill — bulletproof (VML) para que Outlook lo pinte. */
export function button(href: string, label: string, accent: Accent = 'sage') {
  const a = ACCENTS[accent]
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 8px">
    <tr><td align="center" bgcolor="${a.base}" style="border-radius:999px">
      <a href="${esc(href)}"
         style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:999px">
        ${esc(label)}
      </a>
    </td></tr>
  </table>`
}

/** Enlace secundario debajo del botón. */
export function link(href: string, label: string) {
  return `<p style="margin:0 0 4px;font-size:13px;line-height:1.5;font-family:${FONT}"><a href="${esc(href)}" style="color:${C.body};text-decoration:underline">${esc(label)}</a></p>`
}

export function divider() {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px"><tr><td style="border-top:1px solid ${C.line};font-size:0;line-height:0">&nbsp;</td></tr></table>`
}

// ── El armazón ───────────────────────────────────────────────────────────────

export type EmailDoc = {
  /** Renglón gris que se ve al lado del asunto en la bandeja. Obligatorio. */
  preheader: string
  /** Chip arriba del título. */
  eyebrow?: string
  title: string
  accent?: Accent
  /** Cuerpo ya armado con los bloques de arriba. */
  body: string
  /** Renglón chico bajo el pie, dentro de la tarjeta. */
  footnote?: string
}

export function renderEmail(doc: EmailDoc): string {
  const a = ACCENTS[doc.accent ?? 'sage']
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(doc.title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-font-smoothing:antialiased">
  <div style="display:none;font-size:1px;color:${C.page};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${esc(doc.preheader)}</div>
  <div style="display:none;max-height:0;overflow:hidden">&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}">
    <tr><td align="center" style="padding:32px 16px 44px">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">

        <!-- Logo -->
        <tr><td align="center" style="padding:4px 0 22px">
          <a href="${APP_URL}" style="text-decoration:none">
            <img src="${LOGO_URL}" width="118" alt="Healthier" style="display:block;width:118px;height:auto;border:0">
          </a>
        </td></tr>

        <!-- Tarjeta -->
        <tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:26px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:34px 34px 30px">
              ${doc.eyebrow ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px"><tr>
                  <td style="background:${a.soft};border-radius:999px;padding:6px 13px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${a.ink}">${esc(doc.eyebrow)}</td>
                </tr></table>` : ''}
              <h1 style="margin:0 0 14px;font-family:${FONT};font-size:27px;line-height:1.22;font-weight:600;letter-spacing:-.4px;color:${C.ink}">${doc.title}</h1>
              ${doc.body}
              ${doc.footnote ? `<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:${C.mute};font-family:${FONT}">${doc.footnote}</p>` : ''}
            </td></tr>
          </table>
        </td></tr>

        <!-- Pie -->
        <tr><td align="center" style="padding:24px 16px 0">
          <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:${C.mute};font-family:${FONT}">
            <a href="${APP_URL}/paciente/dashboard" style="color:${C.mute};text-decoration:underline">Mi cuenta</a>
            &nbsp;·&nbsp;
            <a href="${APP_URL}/paciente/consultas" style="color:${C.mute};text-decoration:underline">Mis consultas</a>
            &nbsp;·&nbsp;
            <a href="${APP_URL}/terminos" style="color:${C.mute};text-decoration:underline">Términos</a>
          </p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:${C.mute};font-family:${FONT}">
            Healthier · Buenos Aires, Argentina<br>
            Recibís este mail porque tenés una cuenta en Healthier.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`
}
