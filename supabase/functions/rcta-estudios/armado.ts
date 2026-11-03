// ── El armado de la orden de estudios para el servicio de recetas ───────────
// POST {base}/apirecipe/prescribirPractica — wiki bajada en
// website/docs/innovamed-wiki-2026-11-02/2309947393.txt.
//
// Probado contra homologación (2026-11-03):
//   · Varias prácticas en un pedido salen en UNA sola orden (un PDF, un hash).
//     16 prácticas entraron en la misma hoja.
//   · El diagnóstico no es obligatorio.
//   · Con `id` del catálogo (GetPracticas) se emite; con un nombre que no está
//     tal cual en el catálogo el servicio contesta QBI232 "NO SE ENCONTRÓ LA
//     PRÁCTICA". Por eso cada estudio viaja con su id y lo escrito a mano no se
//     manda: se le pide al profesional que lo elija del listado.
//   · Sin cobertura el servicio imprime "Particulares / No posee".
//
// El médico, el paciente, la matrícula, el domicilio y la firma salen de
// `_shared/rcta/` (mismo código que la receta y los certificados). Todo es
// puro; el control es `armado.test.ts` (`npm run test:estudios`).
// ─────────────────────────────────────────────────────────────────────────────

import {
  armarMedico, armarPaciente, domicilioDe, matriculaDe, nombreYApellido,
} from '../_shared/rcta/mod.ts'

export type EstudioDeOrden = { id: number | null; nombre: string; categoria?: string | null }

/** Lo que guardó la HC (`clinical_entries.data.estudios`) → la forma de la orden. */
// deno-lint-ignore no-explicit-any
export function estudiosDeLaEntrada(data: any): EstudioDeOrden[] {
  const lista = Array.isArray(data?.estudios) ? data.estudios : []
  // deno-lint-ignore no-explicit-any
  return lista.map((e: any) => ({
    id: Number.isInteger(Number(e?.catalogoId)) && Number(e?.catalogoId) > 0 ? Number(e.catalogoId) : null,
    nombre: String(e?.nombre ?? '').trim(),
    categoria: e?.categoria ?? null,
  })).filter((e: EstudioDeOrden) => e.nombre)
}

/** Para comparar el nombre guardado contra el del catálogo: sin mayúsculas ni tildes. */
export function normalizarNombre(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Qué buscar en GetPracticas para encontrar un nombre guardado. El buscador del
 * servicio no siempre encuentra el nombre completo (probado contra producción,
 * 2026-11-03: "Vitamina D" y "Tiroxina T4 Total" dan 0 resultados aunque
 * existen; "vitamina" y "tiroxina" sí los traen). Se prueba el nombre entero,
 * después de a pares de palabras y después cada palabra larga, sin repetir.
 */
export function consultasPara(nombre: string): string[] {
  const limpio = String(nombre ?? '').replace(/[().,'"]/g, ' ').replace(/\s+/g, ' ').trim()
  const palabras = limpio.split(' ').filter(w => w.length >= 3)
  const out = [limpio]
  for (let i = 0; i + 1 < palabras.length; i++) out.push(`${palabras[i]} ${palabras[i + 1]}`)
  out.push(...[...palabras].sort((a, b) => b.length - a.length))
  return [...new Set(out.map(q => q.toLowerCase()))].filter(Boolean)
}

/**
 * Las órdenes guardadas antes de la emisión no tienen el id del catálogo (sólo
 * el nombre, capitalizado). Se busca cada una y se acepta SÓLO una coincidencia
 * exacta del nombre: un parecido podría emitir otro estudio.
 */
export function elegirDelCatalogo(nombre: string, practicas: Array<{ id: number; practica: string; categoria?: string | null }>):
  { id: number; categoria: string | null } | null {
  const buscado = normalizarNombre(nombre)
  const hit = practicas.find(p => normalizarNombre(p.practica) === buscado)
  return hit ? { id: hit.id, categoria: hit.categoria ?? null } : null
}

/**
 * La cobertura, con la misma regla que la receta (`rcta-issue`): la de la
 * consulta manda; si nadie la tocó, vale la del perfil del paciente sólo si
 * está completa (financiador del catálogo + afiliado). Devuelve la cobertura a
 * mandar, o el error para el 422.
 */
export function resolverCobertura(
  // deno-lint-ignore no-explicit-any
  consulta: any, paciente: any,
): { cobertura: { idFinanciador: string; numero: string } | null; error?: { error: string; code: string } } {
  const perfilCompleto = paciente?.coverage_type === 'financiador'
    && paciente?.financiador_id
    && String(paciente?.insurance_num ?? '').trim()
  const cob = consulta?.coverage_type == null && perfilCompleto
    ? { coverage_type: 'financiador', financiador_id: paciente.financiador_id, affiliate_number: paciente.insurance_num }
    : consulta
  if (cob?.coverage_type === 'financiador' && !cob?.financiador_id) {
    return { cobertura: null, error: {
      error: 'La consulta tiene una obra social cargada a mano. Elegila del listado en "Cobertura médica" para poder emitir la orden.',
      code: 'RCTA_FINANCIADOR_SIN_CODIGO',
    } }
  }
  const cobertura = cob?.coverage_type === 'financiador' && cob?.financiador_id
    ? { idFinanciador: String(cob.financiador_id), numero: String(cob.affiliate_number ?? '').trim() }
    : null
  if (cobertura && !cobertura.numero) {
    return { cobertura: null, error: {
      error: 'La consulta tiene obra social pero falta el número de afiliado del paciente. Cargalo en "Cobertura médica" para poder emitir la orden.',
      code: 'RCTA_AFILIADO_FALTANTE',
    } }
  }
  return { cobertura }
}

export function armarPayloadOrden(args: {
  clienteAppId: number
  estudios: EstudioDeOrden[]
  indicaciones?: string | null
  diagnostico?: string | null
  // deno-lint-ignore no-explicit-any
  patient: any
  // deno-lint-ignore no-explicit-any
  professional: any
  // deno-lint-ignore no-explicit-any
  legajo: any
  especialidadLabel: string | null
  firmabase64: string | null
  cobertura: { idFinanciador: string; numero: string } | null
}) {
  const { clienteAppId, estudios, patient, professional, legajo, especialidadLabel, firmabase64, cobertura } = args
  const paciente = armarPaciente(patient, cobertura)
  const medico = armarMedico(professional, legajo, especialidadLabel, firmabase64, { matricula: matriculaDe(legajo) })
  const { apellido } = nombreYApellido(professional)
  const consultorio = apellido ? `Consultorio ${apellido}` : null
  const direccion = String(legajo?.address ?? '').trim()
  const domicilio = domicilioDe(direccion)
  const indicaciones = (args.indicaciones ?? '').trim()
  const diagnostico = (args.diagnostico ?? '').trim()

  return {
    clienteAppId,
    paciente,
    medico,
    prescripcion: estudios.map(e => ({ id: e.id, nombre: e.nombre, cantidad: 1 })),
    // `undefined` no sale en el JSON.
    diagnostico: diagnostico || undefined,
    imprimirDiagnostico: diagnostico ? 'S' : 'N',
    ...(indicaciones ? { indicaciones } : {}),
    ...(domicilio ? { lugarAtencion: { nombreConsultorio: consultorio, domicilio } } : {}),
  }
}

/**
 * Lo que la wiki marca como obligatorio, chequeado ANTES de llamar: un 422 con
 * nombre en vez de un QBI. Vacía = se puede mandar.
 */
// deno-lint-ignore no-explicit-any
export function problemasDeLaOrden(p: any): string[] {
  const out: string[] = []
  const largo = (v: unknown, min: number, max: number) => typeof v === 'string' && v.length >= min && v.length <= max
  const letras = (v: unknown) => typeof v === 'string' && !/\d/.test(v)
  for (const quien of ['paciente', 'medico'] as const) {
    const x = p?.[quien] ?? {}
    if (!largo(x.apellido, 2, 50) || !letras(x.apellido)) out.push(`${quien}.apellido`)
    if (!largo(x.nombre, 2, 50) || !letras(x.nombre)) out.push(`${quien}.nombre`)
    if (!['Pasaporte', 'DNI', 'LE', 'LC', 'CI'].includes(x.tipoDoc)) out.push(`${quien}.tipoDoc`)
    if (x.tipoDoc === 'DNI' && !(/^\d{4,9}$/.test(String(x.nroDoc ?? '')))) out.push(`${quien}.nroDoc`)
    if (!['F', 'M', 'X', 'O'].includes(x.sexo)) out.push(`${quien}.sexo`)
  }
  if (!/^\d{4}[-/]\d{2}[-/]\d{2}/.test(String(p?.paciente?.fechaNacimiento ?? ''))) out.push('paciente.fechaNacimiento')
  const mat = p?.medico?.matricula ?? {}
  if (!['MP', 'MN'].includes(mat.tipo)) out.push('medico.matricula.tipo')
  if (!largo(String(mat.numero ?? ''), 1, 20) || !/\d/.test(String(mat.numero ?? ''))) out.push('medico.matricula.numero')
  if (p?.medico?.firmabase64 && /^data:/.test(p.medico.firmabase64)) out.push('medico.firmabase64')
  if (!Array.isArray(p?.prescripcion) || !p.prescripcion.length) out.push('prescripcion')
  else p.prescripcion.forEach((x: { id?: unknown }, i: number) => {
    if (!Number.isInteger(x?.id) || (x.id as number) <= 0) out.push(`prescripcion[${i}].id`)
  })
  if (!Number.isInteger(p?.clienteAppId)) out.push('clienteAppId')
  const dom = p?.lugarAtencion?.domicilio
  if (!dom) out.push('lugarAtencion.domicilio')
  else {
    const conCalle = dom.calle != null || dom.numero != null
    if (conCalle && !(largo(dom.calle, 2, 50) && largo(String(dom.numero ?? ''), 1, 6))) out.push('lugarAtencion.domicilio.calle/numero')
    if (!conCalle && !largo(dom.direccion, 3, 150)) out.push('lugarAtencion.domicilio.direccion')
  }
  return out
}

const NOMBRES: Record<string, string> = {
  'paciente.nroDoc': 'el DNI del paciente', 'paciente.sexo': 'el sexo del paciente',
  'paciente.fechaNacimiento': 'la fecha de nacimiento del paciente',
  'paciente.nombre': 'el nombre del paciente', 'paciente.apellido': 'el apellido del paciente',
  'paciente.tipoDoc': 'el tipo de documento del paciente',
  'medico.nroDoc': 'tu DNI', 'medico.sexo': 'tu sexo', 'medico.nombre': 'tu nombre', 'medico.apellido': 'tu apellido',
  'medico.tipoDoc': 'tu tipo de documento',
  'medico.matricula.numero': 'tu número de matrícula',
  'medico.matricula.tipo': 'el tipo de tu matrícula (MN o MP)',
  'medico.firmabase64': 'tu firma (volvé a cargarla)',
  'lugarAtencion.domicilio': 'la dirección de tu consultorio',
  'lugarAtencion.domicilio.direccion': 'la dirección de tu consultorio',
  'lugarAtencion.domicilio.calle/numero': 'la calle y el número de tu consultorio',
  'prescripcion': 'al menos un estudio',
  'clienteAppId': 'la configuración del servicio de recetas (avisá a soporte)',
}

export function nombreDelProblemaOrden(clave: string): string {
  if (/^prescripcion\[\d+\]\.id$/.test(clave)) return 'elegir cada estudio del listado'
  return NOMBRES[clave] ?? clave
}
