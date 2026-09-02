// Pure, no network calls — caller (Dashboard.jsx) already has profProfile +
// schedules loaded from its own Promise.all. Derived entirely from data that
// already exists, so no new DB column/migration is needed: a step is "done"
// exactly when the field it represents is actually populated.
//
// Always returns the FULL list of steps (done and pending) — the card
// (ProfileCompletenessCard.jsx) is what decides how to render each one
// (checked off vs. actionable). Nothing here is filtered down to "only what's
// missing"; `completed`/`total`/`isComplete` are just derived counts over the
// same full `steps` array.
//
// Documentos requeridos, uno por paso — reemplaza al viejo paso único
// "Documentación verificada" (2026-08-06). Ese paso sólo miraba
// `profProfile.isVerified`, así que en la única pantalla donde se
// renderizaba (ya verificado) siempre aparecía tildado — no servía para
// avisar que faltaba un documento puntual. El CEO lo pidió explícito: "si no
// subo documentos tienen que aparecer también en tu lista de pendientes".
//
// Sólo se listan los documentos que ya son requeridos en Onboarding.jsx
// (título, matrícula, DNI siempre; certificado de especialista sólo si
// declaró sub-especialidad) — seguro de mala praxis y CUIT son "recomendado"/
// opcionales ahí mismo, así que no se marcan acá como pendientes.
//
// El link a onboarding SÓLO se ofrece si el profesional todavía no está
// verificado: reenviar el onboarding vuelve a poner `is_verified=false` y
// dispara una revisión nueva (ver handleSubmit en Onboarding.jsx), así que
// mandar a un profesional YA verificado a "completar" un documento faltante
// lo desverificaría de rebote. Verificado y con un documento faltante (puede
// pasar: el super admin puede verificar sin haber cargado los seis
// documentos) se muestra igual, pero como dato informativo sin acción —
// ese documento lo tiene que subir el super admin (ver A6).
import { cumplePrecioMinimo, PRECIO_MINIMO_TEXTO } from './tarifas'

/**
 * Atiende en un consultorio físico. `modality_preference` (migración 049) es
 * 'virtual' | 'presencial' | 'ambas'; su comentario en la base la define como
 * lo que "controla si el profesional aparece en búsquedas presenciales".
 * `null` cuenta como virtual: es el default de quien nunca tocó el campo, y
 * no corresponde reclamarle un consultorio que nunca dijo tener.
 */
export function atiendePresencial(profProfile) {
  const m = profProfile?.modalityPreference
  return m === 'presencial' || m === 'ambas'
}

export function getProfileCompleteness(profProfile, schedules, { includeVerification = true } = {}) {
  const steps = []
  if (includeVerification) {
    const canSelfUpload = !profProfile?.isVerified
    const docSteps = [
      { key: 'doc-titulo',     label: 'Título profesional',   done: !!profProfile?.titleDocumentUrl },
      { key: 'doc-matricula',  label: 'Matrícula profesional', done: !!profProfile?.licenseDocumentUrl },
      { key: 'doc-dni',        label: 'DNI',                   done: !!profProfile?.dniDocumentUrl },
    ]
    if (profProfile?.subSpecialty) {
      docSteps.push({ key: 'doc-especialista', label: 'Certificado de especialista', done: !!profProfile?.specialistCertificateDocumentUrl })
    }
    for (const d of docSteps) {
      steps.push(canSelfUpload ? { ...d, href: '/profesional/onboarding?resubmit=1&step=2' } : d)
    }
  }
  steps.push(
    // Mercado Pago va PRIMERO y para todos, verificados o no (Mateo,
    // 2026-08-25). Sin MP conectado el profesional no puede recibir turnos —
    // exactamente igual que sin precio o sin horarios— pero antes no figuraba
    // acá, así que quien estaba en revisión no se enteraba de que le faltaba.
    // Conectarlo NO depende de la verificación: se puede adelantar mientras
    // espera, que es justo para lo que sirve esta lista. `mpConnected` sale de
    // la columna `mp_connected` que ya trae `getByUserId` con su `select('*')`,
    // así que sigue sin haber una llamada de red nueva.
    {
      key: 'mercadopago',
      label: 'Conectar Mercado Pago',
      done: !!profProfile?.mpConnected,
      href: '/profesional/configuracion?tab=cuenta',
    },
    // El precio no se da por cargado con cualquier número: tiene que llegar al
    // piso de la plataforma (Mateo, 2026-09-02). Un profesional con $1.000
    // cargado no está listo para recibir turnos, así que el paso sigue
    // pendiente y el checklist se lo dice con el mínimo adentro del label.
    {
      key: 'precio',
      label: `Precio de consulta (mínimo ${PRECIO_MINIMO_TEXTO})`,
      done: [profProfile?.pricePresencial, profProfile?.priceVideo, profProfile?.sessionPrice].some(cumplePrecioMinimo),
      href: '/profesional/configuracion?tab=tarifas',
    },
    {
      key: 'disponibilidad',
      label: 'Horarios de atención',
      done: (schedules?.length ?? 0) > 0,
      href: '/profesional/configuracion?tab=horarios',
    },
    {
      key: 'zona',
      label: 'Zona de atención presencial',
      done: profProfile?.modalityPreference === 'virtual' || !!profProfile?.zoneId,
      href: '/profesional/configuracion?tab=tarifas',
    },
    {
      key: 'avatar',
      label: 'Foto de perfil',
      done: !!profProfile?.profiles?.avatarUrl,
      href: '/profesional/perfil',
    },
  )

  // Dirección del consultorio — SÓLO para quien declaró que atiende
  // presencial (Mateo, 2026-08-27). A diferencia de los pasos de arriba este
  // no se pushea siempre: a un profesional 100% virtual no le falta nada, y
  // un paso tildado que dice "consultorio" cuando no tiene consultorio
  // confunde más de lo que ayuda.
  //
  // Por qué hacía falta: el onboarding nunca pide la dirección y el campo
  // vive escondido en /profesional/perfil, así que de 27 profesionales sólo
  // 2 la tenían cargada — y sin dirección (que es lo que se geocodifica a
  // lat/lng al guardar) el profesional no puede aparecer en el mapa de
  // pacientes aunque haya dicho que atiende presencial.
  if (atiendePresencial(profProfile)) {
    steps.push({
      key: 'direccion',
      label: 'Dirección del consultorio',
      done: !!profProfile?.address,
      href: '/profesional/perfil',
    })
  }

  const completed = steps.filter(s => s.done).length
  const total = steps.length

  return { steps, completed, total, isComplete: completed === total }
}
