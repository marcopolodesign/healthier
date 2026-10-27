import { supabase } from '../lib/supabase'
import { CONSULTA_VIGENTE } from '../lib/pacienteOnboarding'

/**
 * Panel "Pauta" del super admin (Mateo, 2026-10-27): el embudo de Meta Ads
 * de punta a punta, como "Inversión publicitaria" de TAG.
 *
 * Arriba del embudo (impresiones, clics, visitas) sale de Meta por la Edge
 * Function `meta-pauta` (el token no llega al navegador). De registros para
 * abajo sale de la base, cruzando `profiles.utm_campaign` con los nombres de
 * campaña que devuelve Meta y `utm_content` con el nombre del anuncio. Las
 * definiciones son las del panel de pacientes: lead = terminó el onboarding,
 * consulta = vigente; sin cuentas de prueba.
 */

// Qué campañas van a cada pestaña. Las de Meta se llaman
// AR_Perf_Meta_<Público>_…; una que no matchee no aparece.
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
    const { data, error } = await supabase
      .from('profiles')
      .select('id, utm_campaign, utm_content, requiere_onboarding, onboarding_completado_at, titular_id')
      .eq('role', rol)
      .is('deleted_at', null)
      .not('es_prueba', 'is', true)
      .not('utm_campaign', 'is', null)
      .gte('created_at', `${desde}T00:00:00-03:00`)
      .lte('created_at', `${hasta}T23:59:59-03:00`)
    if (error) throw error
    const filas = data || []
    const ids = filas.map(f => f.id)
    if (!ids.length) return filas

    const enTandas = async (consulta) => {
      const out = []
      for (let i = 0; i < ids.length; i += 100) {
        const { data: d, error: e } = await consulta(ids.slice(i, i + 100))
        if (e) throw e
        out.push(...(d || []))
      }
      return out
    }

    if (rol === 'patient') {
      const [consultas, pagos] = await Promise.all([
        enTandas(t => supabase.from('consultations').select('patient_id, status').in('patient_id', t)),
        enTandas(t => supabase.from('payments').select('patient_id, status').in('patient_id', t).eq('status', 'approved')),
      ])
      const conConsulta = new Set(consultas.filter(c => CONSULTA_VIGENTE.includes(c.status)).map(c => c.patient_id))
      const pagaron = new Set(pagos.map(p => p.patient_id))
      return filas.map(f => ({
        ...f,
        lead: !f.titular_id && f.requiere_onboarding === true && !!f.onboarding_completado_at,
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
