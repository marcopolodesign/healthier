// Inicio de cada rol. Lo usan los guards de App.jsx y las pantallas de auth
// que tienen que mandar a la persona "a su inicio" sin saber de antemano qué es.
export const ROLE_REDIRECTS = {
  patient: '/paciente/dashboard',
  professional: '/profesional/dashboard',
  admin: '/admin/profesionales',
  super_admin: '/super-admin/dashboard',
  pharmacy_admin: '/farmacia/pedidos',
  pharmacy_operator: '/farmacia/pedidos',
  pharmacy_readonly: '/farmacia/pedidos',
}
