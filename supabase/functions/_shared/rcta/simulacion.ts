// ── Simulación de lotes del servicio de recetas — SÓLO STAGING ────────────────
// Homologación nunca devuelve un lote partido, errores parciales ni "Pendiente
// de autorización", así que esos caminos no se podían probar desde el front
// (revisión pre-prod, 2026-11-02). Este módulo arma esas respuestas a partir de
// emisiones REALES contra homologación: las recetas existen allá (se pueden
// abrir, autorizar y anular de verdad) y sólo se reacomoda cómo vienen
// agrupadas y con qué estado.
//
// 🔴 Imposible en producción, por dos llaves que tienen que estar las dos:
//   1. el secret `RCTA_SIMULAR_LOTE=permitido` (sólo cargado en staging), y
//   2. `RCTA_API_URL` de homologación (`.hml.`): con las claves de producción
//      no se activa aunque alguien cargara el secret.
// Si se pide y no está permitido, `rcta-issue` corta con 403 ANTES de emitir.
// Control: `npm run test:rcta-armado`.
// ─────────────────────────────────────────────────────────────────────────────

import type { RctaCallResult } from './http.ts'

export const ESCENARIOS = [
  // Cada medicamento en su propia receta, cada receta lista su medicamento.
  'lote_partido',
  // Una receta con todos y otra con el último: el último queda en dos recetas.
  'lote_compartido',
  // Igual que lote_compartido, con las dos recetas "Pendiente de autorización".
  'compartido_pendiente',
  // Sale todo menos el último, que vuelve en `errores` con su código.
  'parcial',
  // Sale una receta sin lista de medicamentos y un error que no nombra a nadie:
  // con dos o más medicaciones, todas quedan "a revisar".
  'a_revisar',
  // Todo sale, "Pendiente de autorización" (incluidas las posdatadas).
  'pendiente',
] as const
export type Escenario = typeof ESCENARIOS[number]

type Env = { get(k: string): string | undefined }

/** Las dos llaves: el secret de staging y las claves de homologación. */
export function simulacionPermitida(env: Env): boolean {
  return env.get('RCTA_SIMULAR_LOTE') === 'permitido' && /\.hml\./.test(env.get('RCTA_API_URL') ?? '')
}

/**
 * Qué escenario pide el body. `null` si no pide ninguno. Tira si lo pide y no
 * está permitido, o si el nombre no existe: nunca se cae a una emisión normal
 * "por las dudas".
 */
export function escenarioPedido(body: Record<string, unknown>, env: Env): Escenario | null {
  const pedido = body?.simularLote
  if (pedido == null || pedido === '') return null
  if (!simulacionPermitida(env)) throw new Error('RCTA_SIMULACION_NO_DISPONIBLE')
  if (!ESCENARIOS.includes(pedido as Escenario)) throw new Error('RCTA_SIMULACION_DESCONOCIDA')
  return pedido as Escenario
}

// deno-lint-ignore no-explicit-any
type Payload = Record<string, any> & { medicamentos: any[] }
type Llamar = (payload: Record<string, unknown>) => Promise<RctaCallResult>

/**
 * Emite de verdad contra homologación lo que haga falta y devuelve una
 * respuesta con la forma que tendría el lote del escenario.
 */
export async function simularEmision(escenario: Escenario, payload: Payload, llamar: Llamar): Promise<RctaCallResult> {
  const meds = payload.medicamentos
  const codigo = (m: { regNo?: string }) => String(m.regNo ?? '')
  const con = (lista: unknown[]) => ({ ...payload, medicamentos: lista })

  // Una emisión real; devuelve sus recetas o el rechazo tal cual.
  // deno-lint-ignore no-explicit-any
  const emitir = async (lista: any[]): Promise<{ ok: true; data: any } | { ok: false; r: RctaCallResult }> => {
    const r = await llamar(con(lista))
    return r.kind === 'ok' ? { ok: true, data: r.data } : { ok: false, r }
  }
  // deno-lint-ignore no-explicit-any
  const recetasDe = (data: any, lista: any[] | null) => (data?.recetas ?? []).map((x: any) => ({
    ...x, ...(lista ? { medicamentos: lista.map(codigo) } : {}),
  }))
  const respuesta = (recetas: unknown[], status: string, extra: Record<string, unknown> = {}, idTransaccion: string | null = null) => ({
    kind: 'ok' as const,
    status: 200,
    data: {
      idTransaccion,
      recetas,
      errores: [] as Record<string, unknown>[],
      response: recetas.map(() => ({ status })),
      accionPDF: { accionId: 0, descripcion: 'No aplica' },
      simulado: escenario,
      ...extra,
    },
  })

  if (escenario === 'pendiente') {
    const e = await emitir(meds)
    if (!e.ok) return e.r
    return respuesta(recetasDe(e.data, null), 'Pendiente de autorización', {}, e.data?.idTransaccion ?? null)
  }

  if (meds.length < 2) throw new Error('RCTA_SIMULACION_DOS_MEDICAMENTOS')
  const ultimo = meds[meds.length - 1]

  // Si una sub-emisión falla DESPUÉS de que otra salió, lo emitido existe en
  // homologación: se devuelve como lote con un error sin medicamento, así las
  // filas quedan "a revisar" con esas recetas guardadas y no se re-emiten.
  // deno-lint-ignore no-explicit-any
  const aRevisarCon = (recetas: unknown[], tx: string | null, r: RctaCallResult): any => {
    const out = respuesta(recetas, 'Ok', {}, tx)
    out.data.errores = [{ error: 'SIMULACION', mensaje: `Una de las emisiones del lote simulado falló (${r.kind === 'rejected' ? r.status : r.kind}).` }]
    return out
  }

  if (escenario === 'lote_partido') {
    const recetas: unknown[] = []
    let tx: string | null = null
    for (const m of meds) {
      const e = await emitir([m])
      if (!e.ok) return recetas.length ? aRevisarCon(recetas, tx, e.r) : e.r
      tx ??= e.data?.idTransaccion ?? null
      recetas.push(...recetasDe(e.data, [m]))
    }
    return respuesta(recetas, 'Ok', {}, tx)
  }

  if (escenario === 'lote_compartido' || escenario === 'compartido_pendiente') {
    const a = await emitir(meds)
    if (!a.ok) return a.r
    const b = await emitir([ultimo])
    if (!b.ok) return aRevisarCon(recetasDe(a.data, null), a.data?.idTransaccion ?? null, b.r)
    const estado = escenario === 'compartido_pendiente' ? 'Pendiente de autorización' : 'Ok'
    return respuesta([...recetasDe(a.data, meds), ...recetasDe(b.data, [ultimo])], estado, {}, a.data?.idTransaccion ?? null)
  }

  if (escenario === 'parcial') {
    const salen = meds.slice(0, -1)
    const e = await emitir(salen)
    if (!e.ok) return e.r
    const r = respuesta(recetasDe(e.data, salen), 'Ok', {}, e.data?.idTransaccion ?? null)
    r.data.errores = [{ error: 'QBI26', mensaje: 'VERIFIQUE LOS NOMBRES DE MEDICAMENTO INGRESADOS (simulado)', medicamento: codigo(ultimo) }]
    return r
  }

  // a_revisar
  const e = await emitir(meds)
  if (!e.ok) return e.r
  const r = respuesta(recetasDe(e.data, null), 'Ok', {}, e.data?.idTransaccion ?? null)
  r.data.errores = [{ error: 'QBI99', mensaje: 'ERROR DEL LOTE SIN MEDICAMENTO (simulado)' }]
  return r
}
