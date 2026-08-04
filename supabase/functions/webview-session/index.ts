// Sesión para el WebView de la app mobile.
//
// La app embebe pantallas del website (hoy: la videollamada del profesional,
// que trae chat + HC + recetas). Para loguear ese WebView SIN compartir el
// refresh token de la app (dos clientes rotando el mismo token terminan
// revocándose la familia y deslogueando a ambos), se genera un magic link:
// al seguirlo, Supabase crea una sesión NUEVA e independiente para el
// browser embebido y redirige a la URL pedida con los tokens en el fragment
// (el cliente web ya tiene detectSessionInUrl: true).
//
// Seguridad: requiere el JWT del usuario (el link se emite para ese mismo
// usuario, nunca para otro) y el redirect está restringido al dominio del
// website.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ALLOWED_REDIRECT_PREFIX = 'https://gethealthier.vercel.app/'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { redirectTo } = await req.json()
    if (typeof redirectTo !== 'string' || !redirectTo.startsWith(ALLOWED_REDIRECT_PREFIX)) {
      return new Response(JSON.stringify({ error: 'redirectTo inválido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    const anon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await anon.auth.getUser()
    if (userErr || !user?.email) {
      return new Response(JSON.stringify({ error: 'No autenticado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email,
      options: { redirectTo },
    })
    if (error) throw error

    return new Response(JSON.stringify({ url: data.properties.action_link }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
