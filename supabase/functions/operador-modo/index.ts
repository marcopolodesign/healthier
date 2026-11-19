// ── operador-modo — la cuenta operadorN entra "como" el profesional real ─────
// Migración 242 (decisión de Mateo, 2026-11-19). Lo llama la cuenta operadorN
// (con su sesión) con `{ dni, fotoPath? }`, el DNI de la persona que está detrás
// de la cuenta ese día.
//   · DNI de un profesional VERIFICADO de la lista de la entidad
//     (emergency_provider_profesionales) → abre una sesión real de ese
//     profesional (mismo mecanismo que impersonate-user) y devuelve
//     `{ modo: 'profesional', session, profesional }`. Con esa sesión
//     la emergencia, la consulta, la HC y la receta quedan a su nombre.
//     Cada ingreso queda en `operador_sesiones_log` (cuenta, profesional, DNI,
//     session_id) y las emergencias en curso del móvil pasan a él.
//   · Cualquier otro DNI → `{ modo: 'registro' }`: la UI sigue con el registro
//     del día de la migración 241 (nombre, selfie, DNI, SISA; sin receta).
// Sólo cuentas con rol emergency_crew y crew_role 'operador' activo.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const soloNumeros = (s: unknown) => String(s ?? '').replace(/\D/g, '')

function sessionIdDelJwt(jwt: string): string | null {
  try {
    const c = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof c.session_id === 'string' ? c.session_id : null
  } catch { return null }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: { user: caller } } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } }
    if (!caller) return json({ error: 'No autenticado' }, 401)

    const { data: perfil } = await admin.from('profiles').select('role').eq('id', caller.id).maybeSingle()
    const { data: crew } = await admin.from('ambulance_crew')
      .select('ambulance_id').eq('profile_id', caller.id).eq('active', true).eq('crew_role', 'operador')
    if (perfil?.role !== 'emergency_crew' || !crew?.length) return json({ error: 'Sólo una cuenta de operador entra en modo operador' }, 403)

    const body = await req.json().catch(() => ({}))
    const dni = soloNumeros(body.dni)
    if (!/^[0-9]{7,8}$/.test(dni)) return json({ error: 'El DNI tiene que tener 7 u 8 números.' }, 422)
    const fotoPath = typeof body.fotoPath === 'string' && body.fotoPath.startsWith(`${caller.id}/`) ? body.fotoPath : null

    // La entidad de la cuenta: la de su móvil.
    const { data: ambs } = await admin.from('ambulances').select('provider_id').in('id', crew.map(c => c.ambulance_id))
    const providerId = ambs?.find(a => a.provider_id)?.provider_id ?? null
    if (!providerId) return json({ modo: 'registro' })

    // Profesionales de la lista de la entidad cuyo DNI coincide.
    const { data: lista } = await admin.from('emergency_provider_profesionales')
      .select('professional_id').eq('provider_id', providerId).eq('active', true)
    const ids = (lista ?? []).map(l => l.professional_id)
    if (!ids.length) return json({ modo: 'registro' })
    const { data: perfiles } = await admin.from('profiles').select('id, email, full_name, dni').in('id', ids)
    const coinciden = (perfiles ?? []).filter(p => soloNumeros(p.dni) === dni)
    if (!coinciden.length) return json({ modo: 'registro' })
    if (coinciden.length > 1) return json({ error: 'Ese DNI figura en más de un profesional de la lista. Avisá a Healthier.' }, 409)
    const pro = coinciden[0]

    // "Con su verificación de siempre": tiene que estar verificado.
    const { data: pp } = await admin.from('professional_profiles').select('is_verified').eq('user_id', pro.id).maybeSingle()
    if (!pp?.is_verified) return json({ modo: 'registro', motivo: 'profesional_no_verificado' })
    if (!pro.email) return json({ error: 'El profesional no tiene mail cargado' }, 409)

    // Sesión real del profesional (magic link canjeado acá mismo, sin salir del servidor).
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: pro.email })
    if (linkErr) throw linkErr
    // Cliente aparte: verifyOtp deja la sesión puesta en el cliente que lo llama.
    const canjeador = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: canje, error: canjeErr } = await canjeador.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' })
    if (canjeErr || !canje.session) throw canjeErr ?? new Error('No se pudo abrir la sesión')
    const sessionId = sessionIdDelJwt(canje.session.access_token)
    if (!sessionId) throw new Error('La sesión no trae session_id')

    const { error: logErr } = await admin.from('operador_sesiones_log').insert({
      operator_id: caller.id, professional_id: pro.id, provider_id: providerId,
      dni_ingresado: dni, session_id: sessionId, foto_path: fotoPath,
    })
    if (logErr) {
      // Sin el asiento no hay sesión: se cierra la que se acaba de abrir.
      await admin.auth.admin.signOut(canje.session.access_token).catch(() => {})
      throw logErr
    }
    const { data: tomadas } = await admin.rpc('tomar_emergencias_en_modo_operador', { p_cuenta: caller.id, p_profesional: pro.id })

    return json({
      modo: 'profesional',
      session: {
        access_token: canje.session.access_token,
        refresh_token: canje.session.refresh_token,
        expires_at: canje.session.expires_at,
      },
      profesional: { id: pro.id, nombre: pro.full_name },
      emergencias_tomadas: tomadas ?? 0,
    })
  } catch (err) {
    console.error('operador-modo error:', err)
    return json({ error: 'Error interno', detail: (err as { message?: string })?.message ?? JSON.stringify(err) }, 500)
  }
})
