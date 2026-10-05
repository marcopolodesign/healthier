// Qué guía de uso le toca a cada rol. Vive aparte del contenido para que el
// menú lo pueda importar sin cargarse el texto entero de las guías.
export const GUIA_DE_ROL = {
  patient: 'paciente',
  professional: 'profesional',
  pharmacy_admin: 'farmacia',
  pharmacy_operator: 'farmacia',
  pharmacy_readonly: 'farmacia',
  emergency_admin: 'emergencias',
  emergency_operator: 'emergencias',
  emergency_crew: 'emergencias',
  super_admin: 'super-admin',
}

/** Las guías que se abren sin sesión. La del super admin pide la suya. */
export const GUIAS_PUBLICAS = ['paciente', 'profesional', 'farmacia', 'emergencias']

export const urlDeGuia = (role) => `/guia/${GUIA_DE_ROL[role] ?? ''}`
