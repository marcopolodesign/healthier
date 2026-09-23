// Interpolación de color en hex — usada por el carrusel on demand del inicio
// para mezclar el degradé de fondo entre la especialidad activa y la
// siguiente mientras se arrastra (CLAUDE.md: valor dinámico imposible en
// Tailwind, se calcula acá y se aplica vía CSS custom property en un ref).

function hexToRgb(hex) {
  const n = hex.replace('#', '')
  const v = n.length === 3 ? n.split('').map(c => c + c).join('') : n
  const num = parseInt(v, 16)
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 }
}

function toHex(n) {
  return Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
}

/** Mezcla `hexA` → `hexB` en la proporción `t` (0 = hexA, 1 = hexB). */
export function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  const clamped = Math.min(1, Math.max(0, t))
  const r = a.r + (b.r - a.r) * clamped
  const g = a.g + (b.g - a.g) * clamped
  const bl = a.b + (b.b - a.b) * clamped
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`
}
