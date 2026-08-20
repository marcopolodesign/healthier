// Guideline 5.1.1(v) de Apple: la app tiene que poder eliminar la cuenta del
// usuario, no solo desactivarla. Pero clinical_entries/conditions/allergies/
// observations/medications tienen retención legal de 10 años (Ley 26.529
// Art. 18, ver block_clinical_delete() en la DB) y profiles.id -> auth.users.id
// es ON DELETE CASCADE — un delete real de auth.users arrastraría profiles y,
// si el paciente tiene historia clínica real, chocaría contra ese trigger y
// la operación entera fallaría. Por eso acá NUNCA se hace DELETE de profiles
// ni de auth.users: se anonimiza el PII de profiles (columna deleted_at
// marca cuándo) y se banea el usuario de auth por 100 años + se le rota el
// email a uno no usable, para que el acceso quede permanentemente cerrado
// sin romper la retención legal de la historia clínica subyacente.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
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

    const { error: profileErr } = await admin
      .from('profiles')
      .update({
        full_name: 'Usuario eliminado',
        email: `deleted-${caller.id}@deleted.healthier.app`,
        phone: null, address: null, dni: null, avatar_url: null,
        insurance_name: null, insurance_num: null, coverage_type: null, financiador_id: null,
        emergency_name: null, emergency_phone: null, emergency_rel: null,
        birth_date: null, blood_type: null, gender: null,
        height_cm: null, weight_kg: null, allergies: null,
        utm_source: null, utm_medium: null, utm_campaign: null, utm_id: null, utm_content: null,
        referrer_url: null,
        deleted_at: new Date().toISOString(),
      })
      .eq('id', caller.id)
    if (profileErr) throw profileErr

    // 100 años + email no usable = acceso cerrado para siempre en la práctica,
    // sin el DELETE real que rompería la retención legal de la historia clínica.
    const { error: banErr } = await admin.auth.admin.updateUserById(caller.id, {
      ban_duration: '876000h',
      email: `deleted-${caller.id}@deleted.healthier.app`,
      password: crypto.randomUUID() + crypto.randomUUID(),
    })
    if (banErr) throw banErr

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
