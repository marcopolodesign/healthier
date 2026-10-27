import { supabase, toCamelCase } from '../lib/supabase'
import { CONSULTA_VIGENTE, esLead } from '../lib/pacienteOnboarding'

/**
 * Panel "Pauta" del super admin (Mateo, 2026-10-27): el embudo de Meta Ads
 * de punta a punta, como "Inversión publicitaria" de TAG.
 *
 * Arriba del embudo (impresiones, clics, visitas) sale de Meta por la Edge
 * Function `meta-pauta` (el token no llega al navegador). De registros para
 * abajo sale de la base: `profiles.utm_campaign` decide la pestaña (PUBLICO) y
 * `utm_content` es el nombre del anuncio. Las
 * definiciones son las del panel de pacientes: lead = terminó el onboarding,
 * consulta = vigente; sin cuentas de prueba.
 */

// Qué campañas van a cada pestaña. Las de Meta se llaman
// AR_Perf_Meta_<Público>_…; una que no matchee no aparece. Los registros se
// toman por este patrón y no por la lista de campañas con gasto en el rango:
// alguien que clickeó una campaña ya pausada y se registró después cuenta igual.
export const PUBLICO = {
  pacientes: { patron: /pacientes/i, rol: 'patient' },
  profesionales: { patron: /profesionales/i, rol: 'professional' },
}

export const pautaService = {
  async meta(desde, hasta) {
    const { data, error } = await supabase.functions.invoke('meta-pauta', { body: { desde, hasta } })
    if (error) {
      const detalle = await error.context?.json?.().catch(() => null)
      throw new Error(detalle?.error || error.message)
    }
    return data
  },

  /** Registros de la base en el rango, con lo que hace falta para cada etapa. */
  async registros(rol, desde, hasta) {
    // Paginado: PostgREST corta en 1000 filas sin avisar.
    const filas = []
    for (let desdeFila = 0; ; desdeFila += 1000) {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, utm_campaign, utm_content, requiere_onboarding, onboarding_completado_at, titular_id')
        .eq('role', rol)
        .is('deleted_at', null)
        .not('es_prueba', 'is', true)
        .ilike('utm_campaign', '%meta%')
        .gte('created_at', `${desde}T00:00:00-03:00`)
        .lte('created_at', `${hasta}T23:59:59-03:00`)
        .order('created_at')
        .range(desdeFila, desdeFila + 999)
      if (error) throw error
      filas.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    const ids = filas.map(f => f.id)
    if (!ids.length) return filas

    const tandas = []
    for (let i = 0; i < ids.length; i += 100) tandas.push(ids.slice(i, i + 100))
    const enTandas = async (consulta) => {
      const res = await Promise.all(tandas.map(consulta))
      const err = res.find(r => r.error)?.error
      if (err) throw err
      return res.flatMap(r => r.data || [])
    }

    if (rol === 'patient') {
      const [consultas, pagos] = await Promise.all([
        enTandas(t => supabase.from('consultations').select('patient_id').in('patient_id', t).in('status', CONSULTA_VIGENTE)),
        // Sólo cobros de consultas: payments también lleva farmacia y emergencias (107).
        enTandas(t => supabase.from('payments').select('patient_id').in('patient_id', t).eq('status', 'approved').not('consultation_id', 'is', null)),
      ])
      const conConsulta = new Set(consultas.map(c => c.patient_id))
      const pagaron = new Set(pagos.map(p => p.patient_id))
      return filas.map(f => ({
        ...f,
        lead: esLead(toCamelCase(f)),
        consulta: conConsulta.has(f.id),
        pago: pagaron.has(f.id),
      }))
    }

    const legajos = await enTandas(t => supabase.from('professional_profiles').select('user_id, submitted_at, is_verified').in('user_id', t))
    const porId = new Map(legajos.map(l => [l.user_id, l]))
    return filas.map(f => ({
      ...f,
      legajo: !!porId.get(f.id)?.submitted_at,
      verificado: !!porId.get(f.id)?.is_verified,
    }))
  },
}
