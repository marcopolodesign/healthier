// "Iniciar sesión como" desde el super admin — para poder ver la app tal
// cual la ve un paciente o profesional puntual (debugging, soporte, ayudar a
// alguien trabado en el onboarding) sin conocer ni tocar su contraseña.
//
// El service role key nunca sale de acá — el frontend sólo recibe la URL del
// magic link ya generada. Cada uso queda registrado en impersonation_log
// (quién impersonó a quién y cuándo), sin excepciones: es acceso a una
// cuenta ajena en una plataforma de salud, tiene que quedar trazado igual
// que un acceso a historia clínica.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { targetUserId } = await req.json()
    if (typeof targetUserId !== 'string' || !targetUserId) {
      return new Response(JSON.stringify({ error: 'targetUserId requerido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    const anon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user: caller }, error: callerErr } = await anon.auth.getUser()
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: 'No autenticado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single()
    if (callerProfile?.role !== 'super_admin') {
      return new Response(JSON.stringify({ error: 'Sólo super_admin puede iniciar sesión como otro usuario' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: targetProfile, error: targetErr } = await admin
      .from('profiles')
      .select('id, email')
      .eq('id', targetUserId)
      .single()
    if (targetErr || !targetProfile?.email) {
      return new Response(JSON.stringify({ error: 'Usuario no encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: targetProfile.email,
    })
    if (linkErr) throw linkErr

    await admin.from('impersonation_log').insert({
      admin_id: caller.id,
      admin_email: caller.email,
      target_user_id: targetProfile.id,
      target_email: targetProfile.email,
    })

    return new Response(JSON.stringify({ url: linkData.properties.action_link }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err instanceof Error ? err.message : err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
