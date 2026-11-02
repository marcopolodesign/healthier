// ── El bloque `medico` (Generar Receta / Otras Prescripciones) ────────────────
// Wiki: `matricula.tipo` MP/MN, `numero`, y `provincia` OBLIGATORIA si es MP
// (QBI65 "PARA EL TIPO MP DEBE INGRESAR LA PROVINCIA DE LA MATRICULA").
// `profesion` es "mandatorio por sobre la especialidad": si va vacía el
// servicio pone "Médico", y el PDF imprime "<PROFESIÓN> - <ESPECIALIDAD>".
// Hasta el 2026-11-02 la especialidad viajaba como slug y el PDF decía
// "MÉDICO - MEDICINA_GENERAL".
//
// El `sello` NO se manda: la plantilla ya imprime nombre, profesión y
// matrícula, y mandarlo las pisa (segunda fuente de verdad para lo mismo).
// La firma va en base64 CRUDO (ver `firma.ts`).
// ─────────────────────────────────────────────────────────────────────────────

import { mapSexo, nombreYApellido } from './personas.ts'
import { esProvinciaMatricula } from './provincias.ts'

// Especialidad → profesión [masculino, femenino]. Las que pueden recetar
// (catálogo `specialties.puede_recetar`) son todas de un médico; el resto
// queda para Otras Prescripciones (certificados).
const MEDICO: [string, string] = ['Médico', 'Médica']
const PROFESIONES: Record<string, [string, string]> = {
  nutricion: ['Nutricionista', 'Nutricionista'],
  psicologia: ['Psicólogo', 'Psicóloga'],
  kinesiologia: ['Kinesiólogo', 'Kinesióloga'],
  odontologia: ['Odontólogo', 'Odontóloga'],
  veterinaria: ['Veterinario', 'Veterinaria'],
}
const NO_MEDICAS = new Set([...Object.keys(PROFESIONES), 'entrenamiento', 'otra'])

/**
 * La profesión para el PDF. Médico/Médica para toda especialidad médica (y
 * para un slug desconocido: sólo recetan médicos, migración 116); la propia
 * para nutrición, psicología, etc. `null` para entrenamiento/otra, donde no
 * hay una profesión de salud que decir.
 */
export function profesionDe(specialtySlug: string | null | undefined, gender?: string | null): string | null {
  const slug = String(specialtySlug ?? '').trim().toLowerCase()
  const fem = gender === 'femenino' ? 1 : 0
  if (PROFESIONES[slug]) return PROFESIONES[slug][fem]
  if (NO_MEDICAS.has(slug)) return null
  return MEDICO[fem]
}

/** "medicina_general" → "Medicina general". Respaldo si el catálogo no responde. */
export function etiquetaDeSlug(slug: string | null | undefined): string {
  const t = String(slug ?? '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}

/**
 * La etiqueta legible de una especialidad, del catálogo `specialties`
 * (migración 101): "Medicina General", no `medicina_general`. Nunca tira; sin
 * catálogo cae a `etiquetaDeSlug`.
 */
export async function etiquetaEspecialidad(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  slug: string | null | undefined,
): Promise<string> {
  if (!slug) return ''
  try {
    const { data } = await supabase.from('specialties').select('label').eq('slug', slug).maybeSingle()
    if (data?.label) return String(data.label)
  } catch (err) {
    console.error('rcta: no se pudo leer la etiqueta de la especialidad:', String(err))
  }
  return etiquetaDeSlug(slug)
}

export type Matricula = { tipo: 'MN' | 'MP'; numero: string; provincia: string | null }

/**
 * La matrícula con la que se firma. `tipo`/`numero` pueden venir de la foto
 * guardada en la medicación (`professional_license_*`); la provincia sale
 * siempre del legajo (`professional_profiles.license_province`, migración 223).
 */
export function matriculaDe(
  // deno-lint-ignore no-explicit-any
  legajo: any,
  foto: { tipo?: string | null; numero?: string | null } = {},
): Matricula {
  const tipo = (foto.tipo ?? legajo?.license_type) === 'MP' ? 'MP' : 'MN'
  const numero = String(foto.numero ?? legajo?.license_number ?? '').trim()
  const provincia = tipo === 'MP' && esProvinciaMatricula(legajo?.license_province) ? legajo.license_province : null
  return { tipo, numero, provincia }
}

/**
 * Qué impide firmar con esta matrícula, ANTES de llamar al servicio: un código
 * nuestro con un mensaje que dice qué hacer.
 *
 * 🔴 La provincia de una MP NO bloquea (decisión de Mateo, 2026-11-02): se pide
 * sin frenar. Si está, se manda; si falta, se emite igual sin `provincia` y el
 * aviso de "cargá la provincia" sigue en el inicio y en el perfil.
 */
export function problemaDeMatricula(m: Matricula): { code: string; error: string } | null {
  if (!m.numero) {
    return { code: 'RCTA_MATRICULA_FALTANTE', error: 'Falta tu número de matrícula. Cargalo en tu perfil para poder emitir.' }
  }
  return null
}

/**
 * El bloque `medico` completo. `especialidadLabel` es la etiqueta legible
 * (ver `etiquetaEspecialidad`); `profesion` se calcula de la especialidad del
 * legajo si no viene.
 */
export function armarMedico(
  // deno-lint-ignore no-explicit-any
  professional: any,
  // deno-lint-ignore no-explicit-any
  legajo: any,
  especialidadLabel: string | null,
  firmabase64: string | null,
  opciones: { matricula?: Matricula; profesion?: string | null } = {},
) {
  const { nombre, apellido } = nombreYApellido(professional)
  const matricula = opciones.matricula ?? matriculaDe(legajo)
  const especialidad = String(especialidadLabel ?? '').slice(0, 120)
  const profesion = opciones.profesion ?? profesionDe(legajo?.specialty, professional?.gender) ?? ''
  return {
    nombre,
    apellido,
    tipoDoc: 'DNI',
    nroDoc: String(professional?.dni ?? '').replace(/\D/g, ''),
    sexo: mapSexo(professional?.gender),
    fechaNacimiento: professional?.birth_date ?? null,
    telefono: professional?.phone ?? null,
    profesion,
    especialidad,
    matricula: {
      tipo: matricula.tipo,
      numero: matricula.numero,
      // Sólo si está cargada: una MP sin provincia se emite igual, sin la clave.
      ...(matricula.tipo === 'MP' && matricula.provincia ? { provincia: matricula.provincia } : {}),
      profesion,
      especialidad,
    },
    ...(firmabase64 ? { firmabase64 } : {}),
  }
}
