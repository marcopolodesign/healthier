// ── Leer lo que contesta el servicio de recetas ───────────────────────────────
// Generar Receta, "¿Cómo funciona el split de prescripciones?": un pedido puede
// generar varias recetas (posdatadas, reglas del financiador, `accionPDF`) y
// cada una se procesa por separado. Si alguna falla, el resto sale igual y la
// respuesta es 200 con `recetas` (las que salieron) y `errores` (las que no,
// cada una con `error`, `mensaje` y `medicamento`). Hay que mirar siempre
// `errores`, no sólo el código HTTP.
//
// Hasta el 2026-11-02 `rcta-issue` marcaba toda la receta como error si había
// algún `errores`: el profesional reintentaba y se emitía DE NUEVO lo que ya
// había salido — una receta legal duplicada.
//
// `response[].status` puede ser "Ok" o "Pendiente de autorización" (reemplaza
// al `authredon` deprecado). Una pendiente existe, pero no se dispensa hasta
// que el validador la autorice.
// ─────────────────────────────────────────────────────────────────────────────

export type Autorizacion = 'ok' | 'pendiente' | null

export type RecetaEmitida = {
  id: string | null            // hash: con esto se anula (DELETE /Receta/{id})
  idReceta: string | null
  fecha: string | null
  s3Link: string | null
  verificador: string | null
  nroCUIR: unknown[] | null
  medicamentos: string[]       // códigos/nombres que trae la receta, si los trae
  autorizacion: Autorizacion
  estado: string | null        // el texto crudo de `status`
}

export type ErrorDeEmision = { error: string | null; mensaje: string | null; medicamentos: string[] }

export type Emision = {
  idTransaccion: string | null
  recetas: RecetaEmitida[]
  errores: ErrorDeEmision[]
  accionPDF: { accionId: number | null; descripcion: string | null } | null
}

/** "Ok" → ok, "Pendiente de autorización" → pendiente, otra cosa → null. */
export function autorizacionDe(status: unknown): Autorizacion {
  const t = String(status ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
  if (!t) return null
  if (t.startsWith('pendiente')) return 'pendiente'
  if (t === 'ok') return 'ok'
  return null
}

/** Los identificadores de medicamento que vienen en cualquier forma. */
function identificadores(v: unknown): string[] {
  if (v == null) return []
  if (Array.isArray(v)) return v.flatMap(identificadores)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return [o.regNo, o.codigo, o.nombreProducto, o.nombre, o.medicamento].flatMap(identificadores)
  }
  return String(v).split(/[,;]/).map(s => s.trim()).filter(Boolean)
}

/** La respuesta 200 de POST /apirecipe/Receta, normalizada. */
// deno-lint-ignore no-explicit-any
export function leerEmision(data: any): Emision {
  const crudas = Array.isArray(data?.recetas) ? data.recetas : []
  const response = Array.isArray(data?.response) ? data.response : []
  // `response[i]` describe la receta `recetas[i]`. Si no vienen parejas y hay
  // una sola, vale para todas. Si no, se busca por medicamento.
  // deno-lint-ignore no-explicit-any
  const statusDe = (r: any, i: number): string | null => {
    if (r?.status) return String(r.status)
    if (response.length === crudas.length) return response[i]?.status ?? null
    if (response.length === 1) return response[0]?.status ?? null
    const meds = new Set(identificadores(r?.medicamentos))
    // deno-lint-ignore no-explicit-any
    const par = response.find((x: any) => identificadores(x?.medicamentos).some(c => meds.has(c)))
    return par?.status ?? null
  }
  // deno-lint-ignore no-explicit-any
  const recetas: RecetaEmitida[] = crudas.map((r: any, i: number) => {
    const estado = statusDe(r, i)
    return {
      id: r?.id ?? null,
      idReceta: r?.idReceta != null ? String(r.idReceta) : (r?.id ?? null),
      fecha: r?.fecha ?? null,
      s3Link: r?.s3Link ?? null,
      verificador: r?.verificador ?? null,
      nroCUIR: Array.isArray(r?.nroCUIR) ? r.nroCUIR : null,
      medicamentos: identificadores(r?.medicamentos),
      autorizacion: autorizacionDe(estado),
      estado,
    }
  })
  // deno-lint-ignore no-explicit-any
  const errores: ErrorDeEmision[] = (Array.isArray(data?.errores) ? data.errores : []).map((e: any) => ({
    error: e?.error ?? null,
    mensaje: e?.mensaje ?? (typeof e === 'string' ? e : null),
    medicamentos: identificadores(e?.medicamento ?? e?.medicamentos),
  }))
  const a = data?.accionPDF
  return {
    idTransaccion: data?.idTransaccion ?? null,
    recetas,
    errores,
    accionPDF: a ? { accionId: a.accionId ?? null, descripcion: a.descripcion ?? null } : null,
  }
}

/** ¿`accionPDF` dice algo que el profesional tenga que saber? (0 = "No aplica"). */
export function accionPdfAviso(e: Emision): string | null {
  const a = e.accionPDF
  if (!a || !a.accionId || Number(a.accionId) === 0) return null
  return a.descripcion?.trim() || null
}

export type MedParaAsignar = { id: string; reg_no?: string | null; medication_name?: string | null }

export type Asignacion = {
  /** medicación → las recetas que la contienen (normalmente una). */
  recetasDe: Map<string, RecetaEmitida[]>
  /** medicación → el error con que no salió. */
  fallidas: Map<string, ErrorDeEmision>
  /** Medicaciones que no se pudo saber si salieron: hubo un error sin medicamento identificable. */
  sinUbicar: string[]
}

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

function coincide(med: MedParaAsignar, ids: string[]): boolean {
  const reg = norm(med.reg_no)
  const nombre = norm(med.medication_name)
  return ids.some(x => {
    const n = norm(x)
    return (reg && n === reg) || (nombre && n.length >= 3 && (n === nombre || nombre.includes(n) || n.includes(nombre)))
  })
}

/**
 * Qué receta le tocó a cada medicación y cuáles fallaron.
 *
 * 1. Un error que nombra un medicamento lo marca fallido.
 * 2. Una receta que lista sus medicamentos se lleva esos.
 * 3. Lo que queda va a las recetas que no listan nada — salvo que haya un
 *    error sin medicamento identificable: ahí no se sabe si lo que queda salió
 *    o no, y va a `sinUbicar` (ni emitido ni "reintentá": revisarlo).
 */
export function asignarRecetas(e: Emision, meds: MedParaAsignar[]): Asignacion {
  const recetasDe = new Map<string, RecetaEmitida[]>()
  const fallidas = new Map<string, ErrorDeEmision>()
  let errorSinMedicamento = false

  for (const err of e.errores) {
    const tocadas = err.medicamentos.length ? meds.filter(m => coincide(m, err.medicamentos)) : []
    if (!tocadas.length) errorSinMedicamento = true
    for (const m of tocadas) if (!fallidas.has(m.id)) fallidas.set(m.id, err)
  }

  const conLista = e.recetas.filter(r => r.medicamentos.length)
  const sinLista = e.recetas.filter(r => !r.medicamentos.length)
  for (const m of meds) {
    if (fallidas.has(m.id)) continue
    const suyas = conLista.filter(r => coincide(m, r.medicamentos))
    if (suyas.length) recetasDe.set(m.id, suyas)
  }

  const sinUbicar: string[] = []
  for (const m of meds) {
    if (fallidas.has(m.id) || recetasDe.has(m.id)) continue
    if (sinLista.length && !errorSinMedicamento) recetasDe.set(m.id, sinLista)
    else if (!e.errores.length && !sinLista.length && conLista.length) {
      // Recetas que listan medicamentos con otro código que el nuestro: salió
      // todo (no hay errores), sólo no se reconoce cuál es cuál.
      recetasDe.set(m.id, conLista)
    } else sinUbicar.push(m.id)
  }
  return { recetasDe, fallidas, sinUbicar }
}

/**
 * Qué quiere decir la respuesta de una anulación (DELETE /Receta/{hash}).
 * 200 → anulada. Vencida (QBI79) o dispensada → no hacía falta. "Ya había sido
 * previamente anulada" → hecha. Cualquier otra cosa → error, para reintentar.
 */
// deno-lint-ignore no-explicit-any
export function interpretarAnulacion(status: number, r: any): { estado: 'confirmada' | 'no_hacia_falta' | 'error'; detalle: string | null; codigo: string | null } {
  const codigo = (r?.error ?? null) as string | null
  const mensaje = String(r?.mensaje ?? r?.raw ?? '').trim() || null
  if (status >= 200 && status < 300) return { estado: 'confirmada', detalle: mensaje, codigo: null }
  if (codigo === 'QBI79' || /HA VENCIDO/i.test(mensaje ?? '')) return { estado: 'no_hacia_falta', detalle: mensaje, codigo }
  // Respuesta real de homologación (2026-10-22): "La receta ya habia sido
  // previamente anulada". Se mira la frase entera: "no puede ser anulada" no
  // es una anulación hecha.
  if (/PREVIAMENTE ANULADA|YA HAB[IÍ]A SIDO ANULADA/i.test(mensaje ?? '')) return { estado: 'confirmada', detalle: mensaje, codigo }
  if (/DISPENSAD/i.test(mensaje ?? '')) return { estado: 'no_hacia_falta', detalle: mensaje, codigo }
  return { estado: 'error', detalle: mensaje ?? `El servicio de recetas respondió ${status}.`, codigo }
}
