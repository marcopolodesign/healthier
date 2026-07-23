// Patient-facing consent, asked once as a mandatory first step of patient onboarding
// (src/pages/patient/Onboarding.jsx). Professionals have their own, separate consent
// (Ley 25.326 + Términos) baked into professional onboarding's "Datos y privacidad"
// step — not sourced from here, to avoid asking twice.
export const PATIENT_CONSENT_ITEMS = [
  {
    key: 'hipaa',
    title: 'Datos de salud',
    desc: 'Acepto que Healthier almacene mis datos médicos con cifrado AES-256, accesibles solo por profesionales autorizados.',
  },
  {
    key: 'ley25326',
    title: 'Ley 25.326 — Argentina',
    desc: 'Acepto el tratamiento de datos según la Ley de Protección de Datos Personales. Mis datos se almacenan en servidores de Amazon Web Services en São Paulo, Brasil. Puedo ejercer derechos de acceso, rectificación y supresión.',
  },
  {
    key: 'equipo_tratante',
    title: 'Acceso del equipo médico',
    desc: 'Acepto que los profesionales que me atiendan en Healthier puedan acceder a mi información clínica compartida para una atención integral y coordinada. Ver Términos y Condiciones.',
    link: '/terminos',
  },
]
