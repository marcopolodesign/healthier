// acceso-familiar — un familiar sin contraseña entra con el PIN de su titular.
//
// Grupo familiar (migración 181): cada familiar es un paciente con perfil
// propio pero SIN contraseña. Si quiere entrar solo (un adulto mayor que se
// arregla con el teléfono), el titular le genera desde su perfil un código de
// 6 dígitos (`generar_pin_familiar`), de un solo uso y que vence a los 15 min.
//
// Esta función lo canjea: `canjear_pin_familiar` (sólo service role) marca el
// PIN como usado, cuenta los intentos por IP y devuelve el familiar. Con eso se
// genera un magic link para su mail interno y se devuelve el `token_hash`, que
// el cliente cambia por una sesión con `supabase.auth.verifyOtp`. No sale
// ningún mail: `generateLink` no envía nada.
//
// Queda con verify_jwt = true (default): la llaman el website y la app con la
// anon key, que es un JWT. No hace falta abrirla del todo, y
// `verificar-pagos.mjs` marca como error cualquier función pública de más.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { pin } = await req.json().catch(() => ({}))
    const limpio = String(pin ?? '').replace(/\D/g, '')
    if (limpio.length !== 6) return json({ error: 'El código tiene 6 números.' }, 400)

    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: familiarId, error: canjeErr } = await admin.rpc('canjear_pin_familiar', { p_pin: limpio, p_ip: ip })
    if (canjeErr) {
      if (canjeErr.code === 'P0429') return json({ error: canjeErr.message }, 429)
      throw canjeErr
    }
    if (!familiarId) return json({ error: 'El código no es válido o ya venció. Pedile uno nuevo a quien te agregó.' }, 401)

    const { data: usuario, error: userErr } = await admin.auth.admin.getUserById(familiarId)
    if (userErr || !usuario?.user?.email) throw userErr ?? new Error('Familiar sin usuario de acceso')

    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: usuario.user.email })
    if (error) throw error

    return json({ tokenHash: data.properties.hashed_token, familiarId })
  } catch (err) {
    console.error('acceso-familiar:', err)
    return json({ error: 'No pudimos abrir la sesión. Probá de nuevo.' }, 500)
  }
})
