/**
 * Tokens de marca para los mails — el mismo sistema que las landings.
 *
 * Se duplican a mano en vez de leerse de `src/index.css` porque las Edge
 * Functions no comparten el bundle del front. Si cambia la paleta allá, cambia
 * acá: son los únicos dos lugares.
 */
export const C = {
  // Fondo del mail y de la tarjeta
  page: '#F6F5F0',   // warm ivory  (--color-bg-primary)
  card: '#FFFFFF',
  soft: '#FAF9F5',   // bloque interno dentro de la tarjeta
  line: '#E7E3DC',

  // Texto
  ink: '#2D2A26',    // --color-text-primary
  body: '#6B6560',   // --color-text-secondary
  mute: '#A8A29E',   // --color-text-tertiary

  // Marca
  sage: '#7CB38B',
  sageInk: '#3F6B4C',
  sageSoft: '#EDF4EF',
  coral: '#E8927C',
  coralInk: '#9C4B36',
  coralSoft: '#FCEFEB',
  lavender: '#9B8EC4',
  lavenderInk: '#584B80',
  lavenderSoft: '#F1EFF8',
  amber: '#E4A853',
  amberInk: '#8A5E13',
  amberSoft: '#FBF2E3',
  danger: '#D9534F',
} as const

export type Accent = 'sage' | 'coral' | 'lavender' | 'amber'

export const ACCENTS: Record<Accent, { base: string; ink: string; soft: string }> = {
  sage:     { base: C.sage,     ink: C.sageInk,     soft: C.sageSoft },
  coral:    { base: C.coral,    ink: C.coralInk,    soft: C.coralSoft },
  lavender: { base: C.lavender, ink: C.lavenderInk, soft: C.lavenderSoft },
  amber:    { base: C.amber,    ink: C.amberInk,    soft: C.amberSoft },
}

// General Sans y Everett son webfonts propias: ningún cliente de mail las carga.
// La pila imita su color de texto (grotesca humanista) con lo que ya está instalado.
export const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,'Helvetica Neue',Arial,sans-serif"

// Deno en las Edge Functions; process.env cuando el script de preview lo corre
// con tsx desde Node. Sin esto, previsualizar los mails obliga a instalar Deno.
const env = (k: string): string | undefined =>
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Deno?.env?.get(k) ?? (globalThis as any).process?.env?.[k]

export const APP_URL = env('APP_URL') ?? 'https://gethealthier.vercel.app'
export const LOGO_URL = `${APP_URL}/email/healthier-logo.png`
