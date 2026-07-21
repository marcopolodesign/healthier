// Pure, no network calls — caller (Dashboard.jsx) already has profProfile +
// schedules loaded from its own Promise.all. Derived entirely from data that
// already exists, so no new DB column/migration is needed: a step is "done"
// exactly when the field it represents is actually populated.
export function getProfileCompleteness(profProfile, schedules) {
  const steps = [
    {
      key: 'documentos',
      label: 'Documentación verificada',
      done: !!profProfile?.isVerified,
    },
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
  ]

  const completed = steps.filter(s => s.done).length
  const total = steps.length

  return { steps, completed, total, isComplete: completed === total }
}
