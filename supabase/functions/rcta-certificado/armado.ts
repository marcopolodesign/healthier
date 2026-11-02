// ── El armado del certificado para el servicio de recetas (Otras Prescripciones) ──
// POST {base}/apirecipe/OtrasPrescripciones — wiki bajada en
// website/docs/innovamed-wiki-2026-11-02/2099773441.txt (generar) y
// 2557575169.txt (anular).
//
// 🔁 PARA REEMPLAZAR: los armados del médico, del paciente y del domicilio son
// los mismos de la receta (`rcta-issue`). Otro trabajo en curso los está
// moviendo a `supabase/functions/_shared/rcta/` (con la provincia de la
// matrícula, la etiqueta de la especialidad y un `parseAddress` que entiende
// las direcciones de Nominatim). Cuando llegue a main, borrar de acá
// `armarMedico`, `armarPaciente`, `domicilioDe`, `provinciaMatricula`,
// `resolverFirma`, `postRcta` e `interpretarAnulacion` e importarlos de ahí.
// Se dejaron locales a propósito para no tocar `rcta-issue` en paralelo.
//
// Todo lo de este archivo es puro salvo `resolverFirma` (lee) y `postRcta` /
// `deleteRcta` (red). El control que falla si se rompe el armado es
// `armado.test.ts` (`deno test supabase/functions/rcta-certificado/`).
// ─────────────────────────────────────────────────────────────────────────────

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

// ── Personas ────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
export function nombreYApellido(p: any) {
  const nombre = (p?.first_name ?? '').trim()
  const apellido = (p?.last_name ?? '').trim()
  if (nombre && apellido) return { nombre, apellido }
  const parts = String(p?.full_name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { nombre: '', apellido: '' }
  if (parts.length === 1) return { nombre: parts[0], apellido: '' }
  return { nombre: parts.slice(0, -1).join(' '), apellido: parts[parts.length - 1] }
}

export function mapSexo(gender: string | null | undefined): 'F' | 'M' | 'X' {
  if (gender === 'femenino') return 'F'
  if (gender === 'masculino') return 'M'
  return 'X'
}

/**
 * La provincia de una matrícula provincial, con los nombres que acepta el
 * servicio (lista "Provincias" de la wiki). Sale del último tramo de la
 * dirección del consultorio, que es lo único que tenemos hoy: no hay columna
 * de provincia de matrícula. `null` si no se reconoce.
 */
const PROVINCIAS: [RegExp, string][] = [
  [/ciudad aut[oó]noma|caba|capital federal/i, 'Ciudad Autonoma de Bs As'],
  [/buenos aires/i, 'Buenos Aires'],
  [/c[oó]rdoba/i, 'Cordoba'], [/santa fe/i, 'Santa Fe'], [/mendoza/i, 'Mendoza'],
  [/tucum[aá]n/i, 'Tucuman'], [/entre r[ií]os/i, 'Entre Rios'], [/salta/i, 'Salta'],
  [/misiones/i, 'Misiones'], [/chaco/i, 'Chaco'], [/corrientes/i, 'Corrientes'],
  [/santiago del estero/i, 'Santiago del Estero'], [/san juan/i, 'San Juan'],
  [/jujuy/i, 'Jujuy'], [/r[ií]o negro/i, 'Rio Negro'], [/neuqu[eé]n/i, 'Neuquen'],
  [/formosa/i, 'Formosa'], [/chubut/i, 'Chubut'], [/san luis/i, 'San Luis'],
  [/catamarca/i, 'Catamarca'], [/la rioja/i, 'La rioja'], [/la pampa/i, 'La Pampa'],
  [/santa cruz/i, 'Santa Cruz'], [/tierra del fuego/i, 'Tierra del Fuego'],
]
export function provinciaMatricula(address: string | null | undefined): string | null {
  const tramos = String(address ?? '').split(',').map(s => s.trim()).filter(Boolean).reverse()
  for (const t of tramos) {
    for (const [re, nombre] of PROVINCIAS) if (re.test(t)) return nombre
  }
  return null
}

/**
 * El domicilio de la atención. La wiki pide calle + número, o `direccion`
 * sola (3 a 150). Acepta las dos formas en que se guarda hoy:
 * "Av. Santa Fe 1900, Recoleta, …" y la de Nominatim "3709, Arenales, …" o
 * "IFER, 2259, Gorriti, …" (altura sola en un tramo, calle en el siguiente).
 * Si no se encuentra la altura va sólo `direccion` — nunca una calle sin número.
 */
export function domicilioDe(address: string | null | undefined) {
  const dir = String(address ?? '').trim()
  if (dir.length < 3) return null
  const tramos = dir.split(',').map(s => s.trim()).filter(Boolean)
  let calle: string | null = null
  let numero: string | null = null
  for (let i = 0; i < tramos.length && !numero; i++) {
    const conAltura = tramos[i].match(/^(.*\D)\s+(\d{1,6})$/)
    if (conAltura && /[a-záéíóúñ]/i.test(conAltura[1])) { calle = conAltura[1].trim(); numero = conAltura[2]; break }
    if (/^\d{1,6}$/.test(tramos[i]) && tramos[i + 1] && /[a-záéíóúñ]/i.test(tramos[i + 1])) {
      numero = tramos[i]; calle = tramos[i + 1]
    }
  }
  const direccion = dir.slice(0, 150)
  return calle && numero && calle.length >= 2
    ? { calle: calle.slice(0, 50), numero, direccion }
    : { direccion }
}

// deno-lint-ignore no-explicit-any
export function armarPaciente(patient: any) {
  const { nombre, apellido } = nombreYApellido(patient)
  return {
    nombre,
    apellido,
    tipoDoc: 'DNI',
    nroDoc: String(patient?.dni ?? '').replace(/\D/g, ''),
    sexo: mapSexo(patient?.gender),
    fechaNacimiento: patient?.birth_date ?? null,
    ...(patient?.phone ? { telefono: patient.phone } : {}),
  }
}

/**
 * El bloque `medico`. `especialidad` va con su nombre legible ("Medicina
 * General", no `medicina_general`): es lo que se imprime en el PDF.
 * La firma va en base64 CRUDO (con `data:` adelante el servicio contesta 200
 * y no la dibuja). El `sello` no se manda: la plantilla ya imprime nombre,
 * especialidad y matrícula, y mandarlo las pisa.
 */
export function armarMedico(
  // deno-lint-ignore no-explicit-any
  professional: any,
  // deno-lint-ignore no-explicit-any
  legajo: any,
  especialidadLabel: string | null,
  firmabase64: string | null,
) {
  const { nombre, apellido } = nombreYApellido(professional)
  const tipo = legajo?.license_type === 'MP' ? 'MP' : 'MN'
  const especialidad = (especialidadLabel ?? '').slice(0, 120)
  return {
    nombre,
    apellido,
    tipoDoc: 'DNI',
    nroDoc: String(professional?.dni ?? '').replace(/\D/g, ''),
    sexo: mapSexo(professional?.gender),
    ...(professional?.birth_date ? { fechaNacimiento: professional.birth_date } : {}),
    ...(professional?.phone ? { telefono: professional.phone } : {}),
    profesion: 'Médico',
    especialidad,
    matricula: {
      tipo,
      numero: String(legajo?.license_number ?? '').replace(/\D/g, ''),
      provincia: tipo === 'MP' ? (provinciaMatricula(legajo?.address) ?? '') : '',
      profesion: 'Médico',
      especialidad,
    },
    ...(firmabase64 ? { firmabase64 } : {}),
  }
}

// ── El certificado ──────────────────────────────────────────────────────────

export type Certificado = {
  tipo: 'constancia' | 'reposo'
  /** Constancia: cuándo fue la atención (ISO). */
  atencionAt?: string | null
  /** Reposo. `desde` en AAAA-MM-DD. */
  dias?: number | null
  desde?: string | null
  indicaciones?: string | null
  cie10Code?: string | null
  cie10Display?: string | null
  imprimirDiagnostico?: boolean
}

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

/** "02/11/2026 a las 14:30 h", en hora argentina. */
export function fechaYHoraAr(iso: string): string {
  const t = new Date(new Date(iso).getTime() - TZ_AR_MS)
  return `${dd(t.getUTCDate())}/${dd(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} a las ${dd(t.getUTCHours())}:${dd(t.getUTCMinutes())} h`
}

const NUMEROS = ['cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
  'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve', 'treinta']

/**
 * El texto que va en el PDF, en la misma hoja que la firma
 * (`prescripcion[].observaciones`). Las `indicaciones` generales salen en una
 * segunda hoja, así que lo que el empleador tiene que leer va acá.
 */
export function textoDelCertificado(c: Certificado, pacienteNombre: string, pacienteDni: string): { titulo: string; cuerpo: string } {
  const quien = `${pacienteNombre}, DNI ${pacienteDni},`
  if (c.tipo === 'constancia') {
    return {
      titulo: 'Constancia de atención médica',
      cuerpo: `Se deja constancia de que ${quien} fue atendido/a en consulta médica el ${fechaYHoraAr(c.atencionAt!)}.`,
    }
  }
  const dias = Number(c.dias)
  const hasta = sumarDias(c.desde!, dias - 1)
  const enLetras = NUMEROS[dias] ?? String(dias)
  return {
    titulo: 'Certificado de reposo laboral',
    cuerpo: `Se indica a ${quien} reposo por ${dias} (${enLetras}) ${dias === 1 ? 'día' : 'días'}, ` +
      (dias === 1 ? `el ${fechaCorta(c.desde!)}.` : `del ${fechaCorta(c.desde!)} al ${fechaCorta(hasta)} inclusive.`),
  }
}

/** Lo que el profesional mandó, validado. Devuelve el error para mostrar o null. */
export function validarCertificado(c: Certificado): string | null {
  if (c.tipo !== 'constancia' && c.tipo !== 'reposo') return 'Elegí el tipo de certificado.'
  if (c.tipo === 'constancia' && (!c.atencionAt || isNaN(new Date(c.atencionAt).getTime()))) {
    return 'Falta la fecha de la atención.'
  }
  if (c.tipo === 'reposo') {
    const dias = Number(c.dias)
    if (!Number.isInteger(dias) || dias < 1 || dias > 30) return 'Los días de reposo van de 1 a 30.'
    if (!c.desde || !/^\d{4}-\d{2}-\d{2}$/.test(c.desde)) return 'Falta desde qué día corre el reposo.'
  }
  if ((c.indicaciones ?? '').length > 1000) return 'Las indicaciones pueden tener hasta 1000 caracteres.'
  if (c.imprimirDiagnostico && !(c.cie10Code || c.cie10Display)) return 'Para incluir el diagnóstico, elegilo primero.'
  return null
}

/**
 * El payload completo. El diagnóstico viaja SÓLO si el profesional prendió
 * "Incluir el diagnóstico": probado contra homologación (2026-11-02), un
 * CIE-10 con `imprimirDiagnostico: 'N'` igual sale impreso en el PDF. Que no
 * viaje es la única garantía de que el empleador no lo ve.
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
  const medico = armarMedico(professional, legajo, especialidadLabel, firmabase64)
  const { titulo, cuerpo } = textoDelCertificado(c, `${paciente.nombre} ${paciente.apellido}`.trim(), paciente.nroDoc)
  const { apellido } = nombreYApellido(professional)
  const consultorio = apellido ? `Consultorio Dr. ${apellido}` : null
  const domicilio = domicilioDe(legajo?.address)
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
      direccionConsultorio: domicilio.direccion,
      nombreConsultorio: consultorio,
      lugarAtencion: { nombreConsultorio: consultorio, domicilio },
    } : {}),
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
  if (mat.tipo === 'MP' && !mat.provincia) out.push('medico.matricula.provincia')
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

// ── Lectura y red ───────────────────────────────────────────────────────────

export async function resolverFirma(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  professionalId: string | null | undefined,
): Promise<string | null> {
  try {
    if (!professionalId) return null
    const { data, error } = await supabase
      .from('professional_signatures').select('firma_png').eq('user_id', professionalId).maybeSingle()
    if (error) { console.error('rcta-certificado: error al leer la firma:', error.message); return null }
    const crudo = String(data?.firma_png ?? '').replace(/^data:image\/\w+;base64,/, '').trim()
    return crudo.length < 100 ? null : crudo
  } catch (err) {
    console.error('rcta-certificado: error al resolver la firma:', String(err))
    return null
  }
}

export type RctaCallResult =
  | { kind: 'network_error'; err: unknown }
  // deno-lint-ignore no-explicit-any
  | { kind: 'rejected'; status: number; body: string; json: any }
  // deno-lint-ignore no-explicit-any
  | { kind: 'ok'; status: number; data: any }

/** Una llamada al servicio. La red se atrapa acá; NUNCA se reintenta un error de red. */
export async function llamarRcta(method: 'POST' | 'DELETE', url: string, apiKey: string, path: string, body: Record<string, unknown>): Promise<RctaCallResult> {
  let res: Response
  try {
    res = await fetch(`${url}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return { kind: 'network_error', err }
  }
  const text = await res.text()
  // deno-lint-ignore no-explicit-any
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch { parsed = text ? { raw: text } : null }
  if (!res.ok) return { kind: 'rejected', status: res.status, body: text, json: parsed }
  return { kind: 'ok', status: res.status, data: parsed }
}

/** Mismo criterio que `rcta-anular` (copiado; ver el 🔁 de arriba). */
// deno-lint-ignore no-explicit-any
export function interpretarAnulacion(status: number, r: any): { estado: 'confirmada' | 'no_hacia_falta' | 'error'; detalle: string | null; codigo: string | null } {
  const codigo = (r?.error ?? null) as string | null
  const mensaje = String(r?.mensaje ?? r?.raw ?? '').trim() || null
  if (status >= 200 && status < 300) return { estado: 'confirmada', detalle: mensaje, codigo: null }
  if (codigo === 'QBI79' || /HA VENCIDO/i.test(mensaje ?? '')) return { estado: 'no_hacia_falta', detalle: mensaje, codigo }
  if (/PREVIAMENTE ANULADA|YA HAB[IÍ]A SIDO ANULADA/i.test(mensaje ?? '')) return { estado: 'confirmada', detalle: mensaje, codigo }
  return { estado: 'error', detalle: mensaje ?? `El servicio de recetas respondió ${status}.`, codigo }
}
