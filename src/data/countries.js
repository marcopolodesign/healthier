/**
 * Códigos de país para el campo de teléfono.
 *
 * Espejo exacto de `COUNTRIES` en `mobile/src/data/geoData.ts`: la app y la web
 * tienen que ofrecer la misma lista y guardar el mismo formato, porque las dos
 * escriben en la misma columna (`profiles.phone`) y de ahí sale el WhatsApp de
 * las campañas. Si se agrega un país acá, agregarlo también allá.
 */
export const COUNTRIES = [
  { code: '+54',  flag: '🇦🇷', name: 'Argentina' },
  { code: '+598', flag: '🇺🇾', name: 'Uruguay' },
  { code: '+56',  flag: '🇨🇱', name: 'Chile' },
  { code: '+55',  flag: '🇧🇷', name: 'Brasil' },
  { code: '+591', flag: '🇧🇴', name: 'Bolivia' },
  { code: '+595', flag: '🇵🇾', name: 'Paraguay' },
  { code: '+51',  flag: '🇵🇪', name: 'Perú' },
  { code: '+57',  flag: '🇨🇴', name: 'Colombia' },
  { code: '+58',  flag: '🇻🇪', name: 'Venezuela' },
  { code: '+593', flag: '🇪🇨', name: 'Ecuador' },
  { code: '+34',  flag: '🇪🇸', name: 'España' },
  { code: '+1',   flag: '🇺🇸', name: 'Estados Unidos' },
  { code: '+52',  flag: '🇲🇽', name: 'México' },
  { code: '+44',  flag: '🇬🇧', name: 'Reino Unido' },
  { code: '+49',  flag: '🇩🇪', name: 'Alemania' },
  { code: '+33',  flag: '🇫🇷', name: 'Francia' },
  { code: '+39',  flag: '🇮🇹', name: 'Italia' },
]

export const DEFAULT_COUNTRY = COUNTRIES[0]

/** Más largo primero: `+591` tiene que ganarle a `+59`/`+5` al comparar prefijos. */
const POR_PREFIJO_MAS_LARGO = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length)

/**
 * Parte un teléfono guardado en { country, number }.
 *
 * Lo que ya está en la base viene de todas las formas posibles (se cargaba en un
 * campo de texto libre). Si no empieza con `+` no se adivina el país: se asume
 * Argentina para el selector y el número se deja entero, tal como lo escribió la
 * persona — adivinar es lo que manda un WhatsApp a un desconocido.
 */
export function splitPhone(value) {
  const raw = (value ?? '').trim()
  if (raw.startsWith('+')) {
    const match = POR_PREFIJO_MAS_LARGO.find(c => raw.startsWith(c.code))
    if (match) return { country: match, number: raw.slice(match.code.length).trim() }
  }
  return { country: DEFAULT_COUNTRY, number: raw }
}

/** Arma el valor que se guarda. Sin número no hay teléfono: devuelve '' y no un `+54` suelto. */
export function joinPhone(country, number) {
  const n = (number ?? '').trim()
  return n ? `${country.code} ${n}` : ''
}
