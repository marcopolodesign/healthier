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
    {
      key: 'precio',
      label: 'Precio de consulta',
      done: !!(profProfile?.pricePresencial || profProfile?.priceVideo || profProfile?.sessionPrice),
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

  const completed = steps.filter(s => s.done).length
  const total = steps.length

  return { steps, completed, total, isComplete: completed === total }
}
