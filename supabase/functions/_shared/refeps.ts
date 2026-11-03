// ── REFEPS por DNI — la consulta y la lectura, sin persistir nada ────────────
// Salió de `sisa-verify` (2026-11-02) para que el chequeo de "completó su DNI"
// (`dni-completado`) use EXACTAMENTE el mismo criterio de coincidencia que la
// verificación del super admin: mismo código REFEPS, mismo normalizado de la
// matrícula, misma regla de "habilitada". Cada función decide qué hace con el
// resultado; acá no se escribe la base.
//
// Va sobre `_shared/msalBus.ts` (token por scope, assertion de un solo uso).
// ─────────────────────────────────────────────────────────────────────────────

import { BusError, busFhir, credencialBus, diagnostico } from './msalBus.ts'

export const SYS_REFEPS = 'https://sisa.msal.gov.ar/REFEPS'
const EXT = 'http://fhir.msal.gob.ar/StructureDefinition/'

export type MatriculaRefeps = {
  profesion: string | null; matricula: string | null; jurisdiccion: string | null
  habilitada: boolean; desde: string | null; emisor: string | null
}

export type EstadoRefeps = 'habilitada' | 'suspendida' | 'not_found' | 'no_coincide'

/** "5410" + DNI a 8 dígitos: el código REFEPS (probado contra el bus 2026-10-08). */
export function codigoRefeps(dni: string): string {
  return `5410${String(dni).replace(/\D/g, '').padStart(8, '0')}`
}

/** "MN - 82854", "082854", "MP 14.613" → "82854" / "14613". */
export function normalizarMatricula(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '').replace(/^0+/, '')
  return d || null
}

// deno-lint-ignore no-explicit-any
export function leerMatriculas(p: any): MatriculaRefeps[] {
  // deno-lint-ignore no-explicit-any
  return (p?.qualification ?? []).map((q: any) => {
    // deno-lint-ignore no-explicit-any
    const ext = (name: string) => q.extension?.find((e: any) => e.url === EXT + name)
    return {
      profesion:    q.code?.coding?.[0]?.display ?? q.code?.text ?? null,
      matricula:    q.identifier?.[0]?.value ?? null,
      jurisdiccion: ext('JurisdMatricula')?.valueCoding?.display ?? null,
      habilitada:   ext('MatriculaHabilitada')?.valueBoolean === true,
      desde:        q.period?.start ?? null,
      emisor:       q.issuer?.display ?? null,
    }
  })
}

/**
 * El veredicto, puro: ¿la matrícula declarada figura y está habilitada?
 * `practitioner` null = no está en REFEPS.
 */
// deno-lint-ignore no-explicit-any
export function evaluarRefeps(practitioner: any | null, matriculaDeclarada: unknown) {
  const declarada = normalizarMatricula(matriculaDeclarada)
  const matriculas = practitioner ? leerMatriculas(practitioner) : []
  const coincide = declarada ? matriculas.find(m => normalizarMatricula(m.matricula) === declarada) : undefined
  let estado: EstadoRefeps
  if (!practitioner) estado = 'not_found'
  else if (!coincide) estado = 'no_coincide'
  else estado = coincide.habilitada && practitioner.active !== false ? 'habilitada' : 'suspendida'
  return { estado, matriculas, coincide: coincide ?? null }
}

export class RefepsError extends Error {
  constructor(public code: string, message: string, public httpStatus?: number, public detail?: unknown) {
    super(message)
  }
}

/**
 * Busca el Practitioner por código REFEPS. `null` = no está. Tira
 * `RefepsError` si el bus no responde, rechaza la credencial o contesta algo
 * que no se entiende — quien llama decide (el chequeo del DNI lo trata como
 * "sin respuesta" y manda a revisión).
 */
// deno-lint-ignore no-explicit-any
export async function buscarPractitioner(codigo: string): Promise<any | null> {
  const cred = credencialBus()
  if (!cred) throw new RefepsError('REFEPS_NOT_CONFIGURED', 'Credencial del bus FHIR no configurada (MSAL_FHIR_ISSUER / MSAL_FHIR_SECRET)')
  let r
  try {
    r = await busFhir(cred, 'Practitioner/*.read', `/fhir/Practitioner?identifier=${encodeURIComponent(`${SYS_REFEPS}|${codigo}`)}`)
  } catch (e) {
    if (e instanceof BusError) throw new RefepsError(e.code, e.message, e.httpStatus, e.detail)
    throw e
  }
  const diag = diagnostico(r)
  // "Recurso del tipo Practitioner con el código X no se encuentra." → no está en REFEPS.
  if (r.status === 404 && /no se encuentra/i.test(diag)) return null
  if (r.status < 200 || r.status >= 300) throw new RefepsError('REFEPS_SEARCH_FAILED', `REFEPS respondió ${r.status}: ${diag}`, r.status, r.body ?? r.text.slice(0, 500))
  if (r.body?.resourceType !== 'Bundle') throw new RefepsError('REFEPS_SEARCH_FAILED', 'Respuesta inesperada de REFEPS', r.status, r.text.slice(0, 500))
  return r.body.entry?.[0]?.resource ?? null
}
