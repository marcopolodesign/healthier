// ── El armado del certificado para el servicio de recetas (Otras Prescripciones) ──
// POST {base}/apirecipe/OtrasPrescripciones — wiki bajada en
// website/docs/innovamed-wiki-2026-11-02/2099773441.txt (generar) y
// 2557575169.txt (anular).
//
// El médico, el paciente, la matrícula (con su provincia), el domicilio, la
// firma y la llamada salen de `_shared/rcta/` — el mismo código que la receta
// de medicamentos. Acá vive sólo lo propio del certificado: los tres modelos,
// sus textos, la validación de lo que manda el profesional y la de la wiki.
//
// Todo es puro. El control que falla si se rompe el armado es `armado.test.ts`
// (`npm run test:certificados`).
// ─────────────────────────────────────────────────────────────────────────────

import {
  armarMedico, armarPaciente, domicilioDe, matriculaDe, nombreYApellido,
} from '../_shared/rcta/mod.ts'

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/** El claim `role` del JWT (el gateway ya verificó la firma: verify_jwt = true). */
export function rolDelJwt(jwt: string): string | null {
  try {
    return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null
  } catch {
    return null
  }
}

// ── El certificado ──────────────────────────────────────────────────────────

export const TIPOS = ['constancia', 'reposo', 'escolar'] as const
export type TipoCertificado = typeof TIPOS[number]

export type Certificado = {
  tipo: TipoCertificado
  /** Cuándo fue la atención (ISO). La lleva la constancia y la usa el escolar. */
  atencionAt?: string | null
  /** Reposo y escolar. `desde` en AAAA-MM-DD. */
  dias?: number | null
  desde?: string | null
  /** Texto libre, los tres modelos: segunda hoja del PDF. */
  indicaciones?: string | null
  cie10Code?: string | null
  cie10Display?: string | null
  imprimirDiagnostico?: boolean
}

export const conDias = (t: TipoCertificado) => t === 'reposo' || t === 'escolar'

const TZ_AR_MS = 3 * 3600 * 1000 // Argentina, sin horario de verano
const dd = (n: number) => String(n).padStart(2, '0')

/** AAAA-MM-DD → DD/MM/AAAA. */
export function fechaCorta(aaaammdd: string): string {
  const [a, m, d] = aaaammdd.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

/** AAAA-MM-DD + n días (calendario, sin husos). */
export function sumarDias(aaaammdd: string, n: number): string {
  const [a, m, d] = aaaammdd.slice(0, 10).split('-').map(Number)
  const f = new Date(Date.UTC(a, m - 1, d + n))
  return `${f.getUTCFullYear()}-${dd(f.getUTCMonth() + 1)}-${dd(f.getUTCDate())}`
}

/** El día argentino (AAAA-MM-DD) de un instante. */
export function diaAr(iso: string): string {
  const t = new Date(new Date(iso).getTime() - TZ_AR_MS)
  return `${t.getUTCFullYear()}-${dd(t.getUTCMonth() + 1)}-${dd(t.getUTCDate())}`
}

/** "02/11/2026 a las 14:30 h", en hora argentina. */
export function fechaYHoraAr(iso: string): string {
  const t = new Date(new Date(iso).getTime() - TZ_AR_MS)
  return `${dd(t.getUTCDate())}/${dd(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} a las ${dd(t.getUTCHours())}:${dd(t.getUTCMinutes())} h`
}

const NUMEROS = ['cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
  'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve', 'treinta']

function periodo(c: Certificado): string {
  const dias = Number(c.dias)
  const enLetras = NUMEROS[dias] ?? String(dias)
  const n = `${dias} (${enLetras}) ${dias === 1 ? 'día' : 'días'}`
  return dias === 1
    ? `${n}, el ${fechaCorta(c.desde!)}`
    : `${n}, del ${fechaCorta(c.desde!)} al ${fechaCorta(sumarDias(c.desde!, dias - 1))} inclusive`
}

export const TITULOS: Record<TipoCertificado, string> = {
  constancia: 'Constancia de atención',
  reposo: 'Certificado de reposo laboral',
  escolar: 'Certificado médico escolar',
}

/** "02/11/2026 a las 14:30", en hora argentina (sin "h": la hora se entiende sola). */
function fechaYHora(iso: string): string {
  return fechaYHoraAr(iso).replace(/ h$/, '')
}

/**
 * El texto que va en el PDF, en la misma hoja que la firma
 * (`prescripcion[].observaciones`). El nombre y el DNI del paciente ya los
 * imprime el encabezado de la plantilla: no se repiten. Las `indicaciones`
 * salen en una segunda hoja, así que lo que el empleador o el colegio tienen
 * que leer va acá. Textos de Felipe (2026-11-02).
 */
export function textoDelCertificado(c: Certificado): { titulo: string; cuerpo: string } {
  const titulo = TITULOS[c.tipo]
  if (c.tipo === 'constancia') {
    return { titulo, cuerpo: `Se deja constancia de que el/la paciente fue atendido/a en consulta médica el ${fechaYHora(c.atencionAt!)}.` }
  }
  if (c.tipo === 'escolar') {
    // El colegio pide el día de reintegro: se calcula solo.
    const reintegro = fechaCorta(sumarDias(c.desde!, Number(c.dias)))
    return { titulo, cuerpo: `Se justifica la inasistencia a clases por ${periodo(c)}. Puede reintegrarse el ${reintegro}.` }
  }
  return { titulo, cuerpo: `Se indica reposo por ${periodo(c)}.` }
}

/**
 * Lo que el profesional mandó, validado. `consultaDia` (AAAA-MM-DD) es el
 * mínimo de "Desde": el reposo y el escolar no corren antes de la consulta
 * (decisión de Mateo, 2026-11-02). Devuelve el error para mostrar o null.
 */
export function validarCertificado(c: Certificado, consultaDia?: string | null): string | null {
  if (!TIPOS.includes(c.tipo)) return 'Elegí el tipo de certificado.'
  if (!c.atencionAt || isNaN(new Date(c.atencionAt).getTime())) return 'Falta la fecha de la atención.'
  if (conDias(c.tipo)) {
    const dias = Number(c.dias)
    if (!Number.isInteger(dias) || dias < 1 || dias > 30) return 'Los días van de 1 a 30.'
    if (!c.desde || !/^\d{4}-\d{2}-\d{2}$/.test(c.desde)) return 'Falta desde qué día corre.'
    if (consultaDia && c.desde < consultaDia) return 'No puede empezar antes del día de la consulta.'
  }
  if ((c.indicaciones ?? '').length > 1000) return 'Las indicaciones pueden tener hasta 1000 caracteres.'
  if (c.imprimirDiagnostico && !(c.cie10Code || c.cie10Display)) return 'Para incluir el diagnóstico, elegilo primero.'
  return null
}

/**
 * El payload completo. El diagnóstico viaja SÓLO si el profesional prendió
 * "Incluir el diagnóstico": probado contra homologación (2026-11-02), un
 * CIE-10 con `imprimirDiagnostico: 'N'` igual sale impreso en el PDF. Que no
 * viaje es la única garantía de que el empleador o el colegio no lo ven.
 */
export function armarPayloadCertificado(args: {
  clienteAppId: number
  certificado: Certificado
  // deno-lint-ignore no-explicit-any
  patient: any
  // deno-lint-ignore no-explicit-any
  professional: any
  // deno-lint-ignore no-explicit-any
  legajo: any
  especialidadLabel: string | null
  firmabase64: string | null
}) {
  const { clienteAppId, certificado: c, patient, professional, legajo, especialidadLabel, firmabase64 } = args
  const paciente = armarPaciente(patient)
  const medico = armarMedico(professional, legajo, especialidadLabel, firmabase64, { matricula: matriculaDe(legajo) })
  const { titulo, cuerpo } = textoDelCertificado(c)
  const { apellido } = nombreYApellido(professional)
  const consultorio = apellido ? `Consultorio ${apellido}` : null
  const direccion = String(legajo?.address ?? '').trim()
  const domicilio = domicilioDe(direccion)
  const diagnostico = c.imprimirDiagnostico ? (c.cie10Code || c.cie10Display || null) : null
  const indicaciones = (c.indicaciones ?? '').trim()

  return {
    clienteAppId,
    paciente,
    medico,
    prescripcion: [{ prescripcion: titulo, cantidad: 1, observaciones: cuerpo }],
    // `undefined` no sale en el JSON: con el interruptor apagado el campo no viaja.
    diagnostico: diagnostico ?? undefined,
    imprimirDiagnostico: diagnostico ? 'S' : 'N',
    ...(indicaciones ? { indicaciones } : {}),
    ...(domicilio ? {
      direccionConsultorio: direccion.slice(0, 150),
      nombreConsultorio: consultorio,
      lugarAtencion: { nombreConsultorio: consultorio, domicilio },
    } : {}),
  }
}

/**
 * La vista previa: lo que va a imprimir el PDF, en el mismo orden, armado del
 * MISMO payload que se manda (no hay vista previa del servicio para Otras
 * Prescripciones: `Receta/Preview` sólo acepta medicamentos — probado contra
 * homologación el 2026-11-02, responde 500). El diagnóstico se muestra como
 * se manda: el código; el servicio le agrega la descripción al imprimir.
 */
// deno-lint-ignore no-explicit-any
export function vistaPrevia(p: ReturnType<typeof armarPayloadCertificado>, fechaHoy: string, diagnosticoLegible: string | null) {
  const m = p.medico
  const dom = p.lugarAtencion?.domicilio as { calle?: string; numero?: string; direccion?: string } | undefined
  return {
    medico: {
      nombre: `${m.nombre} ${m.apellido}`.trim(),
      linea: [m.profesion, m.especialidad].filter(Boolean).join(' - ').toUpperCase(),
      matricula: `${m.matricula.tipo === 'MP' ? 'Matrícula Prov.' : 'Matrícula Nac.'}: ${m.matricula.numero}${m.matricula.tipo === 'MP' && m.matricula.provincia ? ` (${m.matricula.provincia})` : ''}`,
      conFirma: Boolean(m.firmabase64),
    },
    paciente: {
      nombre: `${p.paciente.nombre} ${p.paciente.apellido}`.trim(),
      dni: p.paciente.nroDoc,
      sexo: { F: 'Femenino', M: 'Masculino', X: 'X', O: 'Otro' }[p.paciente.sexo as 'F'] ?? p.paciente.sexo,
      nacimiento: p.paciente.fechaNacimiento ? fechaCorta(String(p.paciente.fechaNacimiento)) : null,
    },
    titulo: p.prescripcion[0].prescripcion,
    cuerpo: p.prescripcion[0].observaciones,
    // Texto libre: va tal cual. CIE-10: sólo el código (el servicio le pone su descripción).
    diagnostico: p.diagnostico ? (diagnosticoLegible ?? p.diagnostico) : null,
    fecha: fechaCorta(fechaHoy),
    consultorio: [p.nombreConsultorio, dom?.calle ? `${dom.calle} ${dom.numero}` : dom?.direccion].filter(Boolean),
    indicaciones: p.indicaciones ?? null,
  }
}

/**
 * Lo que la wiki marca como obligatorio y su formato. Corre ANTES de llamar
 * (un 422 con nombre en vez de un QBI que nadie entiende) y es lo que prueba
 * `armado.test.ts`. Devuelve la lista de problemas; vacía = se puede mandar.
 */
// deno-lint-ignore no-explicit-any
export function problemasDelPayload(p: any): string[] {
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
  // Una MP sin provincia se emite igual, sin la clave (decisión de Mateo, ver _shared/rcta/medico.ts).
  if (p?.medico?.firmabase64 && /^data:/.test(p.medico.firmabase64)) out.push('medico.firmabase64')
  if (!Array.isArray(p?.prescripcion) || !p.prescripcion.length) out.push('prescripcion')
  else p.prescripcion.forEach((x: { prescripcion?: string }, i: number) => {
    if (!x?.prescripcion?.trim()) out.push(`prescripcion[${i}].prescripcion`)
  })
  if (!Number.isInteger(p?.clienteAppId)) out.push('clienteAppId')
  if (!['S', 'N', ''].includes(p?.imprimirDiagnostico ?? '')) out.push('imprimirDiagnostico')
  if (p?.imprimirDiagnostico === 'S' && !(typeof p.diagnostico === 'string' && p.diagnostico.trim())) out.push('diagnostico')
  const dom = p?.lugarAtencion?.domicilio
  if (!dom) out.push('lugarAtencion.domicilio')
  else {
    const conCalle = dom.calle != null || dom.numero != null
    if (conCalle && !(largo(dom.calle, 2, 50) && largo(String(dom.numero ?? ''), 1, 6))) out.push('lugarAtencion.domicilio.calle/numero')
    if (!conCalle && !largo(dom.direccion, 3, 150)) out.push('lugarAtencion.domicilio.direccion')
  }
  return out
}

/**
 * Un certificado dice que hubo atención: no se emite para una consulta
 * cancelada, a la que el paciente no fue, que venció sin atenderse, o que
 * todavía no empezó. Devuelve el error para el 422, o null.
 * Espejo en el front: src/lib/certificadoAtencion.js (test:certificados los compara).
 */
const ESTADOS_ATENDIDA = ['in_progress', 'closing', 'pending_pro_close', 'completed']

export function consultaNoCertificable(
  c: { status: string; started_at: string | null; scheduled_at: string | null },
  ahoraMs: number,
): { error: string; code: string } | null {
  if (c.status === 'cancelled') return { error: 'La consulta está cancelada.', code: 'CERT_CONSULTA_CANCELADA' }
  if (c.status === 'no_show' || c.status === 'expired') {
    return { error: 'La consulta no se llegó a hacer: no se puede emitir un certificado.', code: 'CERT_CONSULTA_NO_REALIZADA' }
  }
  // Hubo atención si arrancó (started_at) o si el estado lo dice: en la
  // llamada, cerrándose o cerrada (migración 098). Una 'confirmed' cuenta desde
  // la hora del turno (decisión de Mateo, 2026-11-02: la atendida por teléfono
  // cuando falló Daily). 'pending' sin arrancar, nunca.
  if (c.started_at || ESTADOS_ATENDIDA.includes(c.status)) return null
  if (c.status === 'confirmed' && c.scheduled_at && Date.parse(c.scheduled_at) <= ahoraMs) return null
  return { error: 'La consulta todavía no empezó: el certificado se emite desde la hora del turno.', code: 'CERT_CONSULTA_FUTURA' }
  return null
}

/** Cada clave que puede devolver problemasDelPayload, dicha para el profesional. */
export const NOMBRE_DEL_PROBLEMA: Record<string, string> = {
  'paciente.nroDoc': 'el DNI del paciente', 'paciente.sexo': 'el sexo del paciente',
  'paciente.fechaNacimiento': 'la fecha de nacimiento del paciente',
  'paciente.nombre': 'el nombre del paciente', 'paciente.apellido': 'el apellido del paciente',
  'paciente.tipoDoc': 'el tipo de documento del paciente',
  'medico.nroDoc': 'tu DNI', 'medico.sexo': 'tu sexo', 'medico.nombre': 'tu nombre', 'medico.apellido': 'tu apellido',
  'medico.tipoDoc': 'tu tipo de documento',
  'medico.matricula.numero': 'tu número de matrícula',
  'medico.matricula.tipo': 'el tipo de tu matrícula (MN o MP)',
  'medico.matricula.provincia': 'la provincia de tu matrícula (la dirección del consultorio)',
  'medico.firmabase64': 'tu firma (volvé a cargarla)',
  'lugarAtencion.domicilio': 'la dirección de tu consultorio',
  'lugarAtencion.domicilio.direccion': 'la dirección de tu consultorio',
  'lugarAtencion.domicilio.calle/numero': 'la calle y el número de tu consultorio (la calle hasta 50 letras)',
  'diagnostico': 'el diagnóstico (o apagá "Imprimir diagnóstico")',
  'imprimirDiagnostico': 'la opción de imprimir el diagnóstico',
  'prescripcion': 'el texto del certificado',
  'clienteAppId': 'la configuración del servicio de recetas (avisá a soporte)',
}

export function nombreDelProblema(clave: string): string {
  if (/^prescripcion\[\d+\]\.prescripcion$/.test(clave)) return 'el texto del certificado'
  return NOMBRE_DEL_PROBLEMA[clave] ?? clave
}

/**
 * Qué hacer cuando el insert choca con la 'pending' de la misma consulta y tipo
 * (índice de la 226). El servicio de recetas no tiene cómo consultar si una
 * prescripción ya existe, así que la regla es no reemitir nunca a ciegas:
 *   · en_curso    la otra emisión sigue (menos de 5 min): 409.
 *   · recuperar   el log dice que el servicio la emitió: se completa la fila con
 *                 lo del log (y su fecha real) y se devuelve como éxito.
 *   · a_revisar   se llegó a llamar al servicio (`llamado_at`) y no hay
 *                 respuesta registrada: puede existir del otro lado. No se emite
 *                 otra hasta que soporte lo revise.
 *   · reintentar  nunca se llamó al servicio: se cierra como error y se reintenta.
 */
export type Recuperacion = 'en_curso' | 'recuperar' | 'a_revisar' | 'reintentar'
export function decidirRecuperacion(
  previa: { created_at: string; llamado_at: string | null },
  logEmitido: { s3_link: string | null } | null,
  ahoraMs: number,
): Recuperacion {
  if (logEmitido?.s3_link) return 'recuperar'
  if (Date.parse(previa.created_at) > ahoraMs - 5 * 60_000) return 'en_curso'
  return previa.llamado_at ? 'a_revisar' : 'reintentar'
}
