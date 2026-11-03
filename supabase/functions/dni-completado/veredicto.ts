// El veredicto del chequeo de "completó su DNI", puro (lo prueba veredicto.test.ts).
import type { EstadoRefeps } from '../_shared/refeps.ts'

export type ResultadoDni = 'coincide' | 'no_coincide' | 'sin_respuesta'

/** Sólo 'habilitada' (la matrícula declarada figura y está habilitada) mantiene la verificación. */
export function veredictoDni(estado: EstadoRefeps, matriculaDeclarada: unknown): { resultado: ResultadoDni; detalle: string } {
  const mat = String(matriculaDeclarada ?? '').trim() || '(sin matrícula)'
  switch (estado) {
    case 'habilitada':  return { resultado: 'coincide', detalle: `La matrícula ${mat} figura habilitada en REFEPS.` }
    case 'suspendida':  return { resultado: 'no_coincide', detalle: `La matrícula ${mat} figura en REFEPS pero no habilitada.` }
    case 'no_coincide': return { resultado: 'no_coincide', detalle: `El DNI está en REFEPS pero la matrícula ${mat} no figura.` }
    case 'not_found':   return { resultado: 'no_coincide', detalle: 'El DNI no está en REFEPS.' }
  }
}
