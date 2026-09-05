/**
 * Carga en Supabase Auth las plantillas de los mails de cuenta —
 * verificación, enlace de acceso, contraseña, cambio de correo, código e
 * invitación — y, si se le pide, el SMTP de Resend.
 *
 *   npx tsx scripts/aplicar-mails-de-auth.ts staging
 *   npx tsx scripts/aplicar-mails-de-auth.ts produccion
 *   npx tsx scripts/aplicar-mails-de-auth.ts staging --smtp
 *
 * Por qué un script y no el dashboard: son seis plantillas HTML de ~6 KB cada
 * una, en dos proyectos. Pegarlas a mano es garantía de que un día queden
 * distintas entre staging y producción, y de que nadie se acuerde de cuál era
 * la buena. Acá la fuente es `_shared/email/templates.ts`, la misma que usan
 * los mails transaccionales, así que las dos familias no se pueden despegar.
 *
 * 🔴 `--smtp` recién cuando el dominio esté verificado en Resend. Con el
 * dominio sin verificar, Resend rechaza todo lo que salga de
 * `@healthier.com.ar` y el resultado sería peor que hoy: en vez de mails feos
 * con el remitente de Supabase, no habría mails.
 */
import * as T from '../supabase/functions/_shared/email/templates.ts'

type Entorno = { ref: string; siteUrl: string; from: string; nombre: string }

const ENTORNOS: Record<string, Entorno> = {
  staging: {
    ref: 'itjhrvlzuqvyhqtffumc',
    siteUrl: 'https://gethealthier-staging.vercel.app',
    // A propósito el remitente de prueba de Resend: entrega SÓLO al dueño de la
    // cuenta, así se prueba el circuito sin depender del DNS y sin riesgo de
    // mandarle un mail de verdad a un paciente de prueba.
    from: 'onboarding@resend.dev',
    nombre: 'Healthier (staging)',
  },
  produccion: {
    ref: 'aixjejdoofervrkggbkd',
    siteUrl: 'https://gethealthier.vercel.app',
    from: 'consultas@healthier.com.ar',
    nombre: 'Healthier',
  },
}

const entorno = ENTORNOS[process.argv[2] ?? '']
const conSmtp = process.argv.includes('--smtp')

if (!entorno) {
  console.error('Uso: npx tsx scripts/aplicar-mails-de-auth.ts <staging|produccion> [--smtp]')
  process.exit(1)
}

const token = process.env.SUPABASE_ACCESS_TOKEN
const resendKey = process.env.RESEND_API_KEY_PARA_SMTP
if (!token) {
  console.error('Falta SUPABASE_ACCESS_TOKEN (está en ~/Local/.env).')
  process.exit(1)
}
if (conSmtp && !resendKey) {
  console.error('Con --smtp hace falta RESEND_API_KEY_PARA_SMTP (la clave de Resend del entorno).')
  process.exit(1)
}

const payload: Record<string, unknown> = {
  // Los asuntos: en castellano y sin el nombre del producto repetido, que ya
  // está en el remitente.
  mailer_subjects_confirmation:   'Confirmá tu correo',
  mailer_subjects_magic_link:     'Tu enlace para entrar a Healthier',
  mailer_subjects_recovery:       'Cambiá tu contraseña',
  mailer_subjects_email_change:   'Confirmá tu correo nuevo',
  mailer_subjects_reauthentication: 'Tu código de verificación',
  mailer_subjects_invite:         'Te invitaron a Healthier',

  mailer_templates_confirmation_content:     T.authConfirmacion(),
  mailer_templates_magic_link_content:       T.authMagicLink(),
  mailer_templates_recovery_content:         T.authRecuperacion(),
  mailer_templates_email_change_content:     T.authCambioDeMail(),
  mailer_templates_reauthentication_content: T.authCodigo(),
  mailer_templates_invite_content:           T.authInvitacion(),

  site_url: entorno.siteUrl,
}

if (conSmtp) {
  Object.assign(payload, {
    smtp_host: 'smtp.resend.com',
    smtp_port: 465,
    smtp_user: 'resend',
    smtp_pass: resendKey,
    smtp_admin_email: entorno.from,
    smtp_sender_name: entorno.nombre,
    // Con SMTP propio se puede levantar el techo del mailer de Supabase, que
    // por defecto deja pasar un mail por minuto y por dirección.
    smtp_max_frequency: 10,
  })
}

const res = await fetch(`https://api.supabase.com/v1/projects/${entorno.ref}/config/auth`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

if (!res.ok) {
  console.error(`✗ ${res.status} — ${await res.text()}`)
  process.exit(1)
}

console.log(`✓ ${process.argv[2]}: 6 plantillas + asuntos${conSmtp ? ' + SMTP de Resend' : ''} aplicados.`)
if (!conSmtp) console.log('  SMTP sin tocar: los mails siguen saliendo por el mailer de Supabase.')
