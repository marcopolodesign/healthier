import { supabase, toCamelCase } from '../lib/supabase'

/**
 * Bitácora del alta del profesional (migración 112).
 *
 * `profiles.onboarding_step` sólo dice hasta dónde llegó alguien; se pisa en
 * cada avance y no guarda fecha. Esto guarda la línea de tiempo: qué hizo, en
 * qué paso y cuándo — que es lo que permite ver dónde se frenó y cuándo retomó.
 *
 * Los triggers de la migración ya registran el alta, cada cambio de paso y los
 * hitos del legajo pase lo que pase del lado del cliente. Lo único que se
 * escribe desde acá es lo que la base no puede ver sola: que abrió el wizard.
 *
 * Regla: registrar NUNCA debe romper el flujo del profesional. La escritura es
 * best-effort y se traga sus errores.
 */

/** Slugs estables. Usar estos y no strings sueltos. */
export const ONBOARDING_EVENTS = {
  SIGNUP:        'signup',
  WIZARD_OPENED: 'wizard_opened',
  STEP_REACHED:  'step_reached',
  SUBMITTED:     'submitted',
  RESUBMITTED:   'resubmitted',
  VERIFIED:      'verified',
  REJECTED:      'rejected',
}

export const professionalOnboardingService = {
  /**
   * El profesional abrió el formulario de alta. Sin este evento, quien entra,
   * mira y se va sin tocar "Siguiente" es indistinguible de quien no volvió
   * nunca — y esa diferencia es justamente "dónde retomó".
   */
  async logWizardOpened(userId, step, detail = null) {
    if (!userId) return
    try {
      await supabase.from('professional_onboarding_events').insert({
        user_id: userId,
        event: ONBOARDING_EVENTS.WIZARD_OPENED,
        step: step ?? null,
        detail,
      })
    } catch {
      // Un log que rompe el alta es peor que no tener log.
    }
  },

  /** Recorrido completo de un profesional, en orden cronológico. */
  async listByUser(userId) {
    const { data, error } = await supabase
      .from('professional_onboarding_events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data ?? []).map(toCamelCase)
  },

  /**
   * Recorrido de varios profesionales de una sola vez (panel de super admin).
   * Devuelve un Map userId → eventos ordenados, para no hacer N consultas.
   */
  async listByUsers(userIds) {
    const ids = [...new Set((userIds ?? []).filter(Boolean))]
    if (!ids.length) return new Map()
    // El límite es explícito porque PostgREST corta en 1000 filas sin avisar:
    // con ~10 asientos por profesional eso se alcanza a los 100 profesionales y
    // el recorrido de los últimos se vería vacío en vez de dar error.
    const { data, error } = await supabase
      .from('professional_onboarding_events')
      .select('*')
      .in('user_id', ids)
      .order('created_at', { ascending: true })
      .limit(20000)
    if (error) throw error
    const porUsuario = new Map()
    for (const row of data ?? []) {
      const e = toCamelCase(row)
      if (!porUsuario.has(e.userId)) porUsuario.set(e.userId, [])
      porUsuario.get(e.userId).push(e)
    }
    return porUsuario
  },
}
