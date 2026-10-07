// reactivar-cuenta — recuperar una cuenta dada de baja, con su historia clínica
// (migración 188).
//
// La llama alguien SIN sesión, desde el registro: por eso es pública
// (`verify_jwt = false` en config.toml). La seguridad no depende del gateway:
// la cuenta sólo se devuelve con el link que llega al mail original, y ese
// link lo arma `send-email` con un token de un solo uso que vence en una hora.
//
// Acciones (body `{ accion, ... }`):
//   · consultar  { email }           → { dadoDeBaja }  (el registro decide qué mostrar)
//   · solicitar  { email }           → manda el mail con el link. Responde ok
//                                      aunque el mail no tenga baja, para no
//                                      confirmar nada que `consultar` no diga.
//   · confirmar  { token, password } → devuelve el mail a auth.users, saca el
//                                      baneo, pone la contraseña nueva y
//                                      `reactivar_perfil` deshace la baja.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const VIGENCIA_MS = 60 * 60 * 1000

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, serviceKey)
    const body = await req.json().catch(() => ({}))
    const email = String(body.email ?? '').trim().toLowerCase()

    const bajaVigente = async () => {
      const { data, error } = await admin
        .from('bajas_de_usuarios')
        .select('user_id, email_original')
        .ilike('email_original', email.replace(/[\\%_]/g, c => `\\${c}`))
        .is('reactivado_at', null)
        .order('dado_de_baja_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    }

    switch (body.accion) {
      case 'consultar': {
        if (!email) return json({ error: 'Falta el mail' }, 400)
        return json({ dadoDeBaja: Boolean(await bajaVigente()) })
      }

      case 'solicitar': {
        if (!email) return json({ error: 'Falta el mail' }, 400)
        const baja = await bajaVigente()
        if (!baja) return json({ ok: true })

        const token = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('')
        const { error } = await admin
          .from('bajas_de_usuarios')
          .update({ reactivacion_token: token, reactivacion_vence_at: new Date(Date.now() + VIGENCIA_MS).toISOString() })
          .eq('user_id', baja.user_id)
        if (error) throw error

        const r = await fetch(`${url}/functions/v1/send-email`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipo: 'reactivar-cuenta', userId: baja.user_id }),
        })
        // send-email nunca tira por un rechazo de Resend: devuelve cuántos
        // salieron. Si no salió ninguno, la pantalla no puede decir "te lo mandamos".
        const res = await r.json().catch(() => null)
        if (!r.ok || !(res?.sent >= 1)) {
          return json({ error: `No pudimos mandarte el mail. Probá de nuevo en un rato o escribinos. (${res?.error ?? 'el envío falló'})` }, 502)
        }
        return json({ ok: true })
      }

      case 'confirmar': {
        const token = String(body.token ?? '')
        const password = String(body.password ?? '')
        if (!token) return json({ error: 'Falta el link de recuperación' }, 400)
        if (password.length < 6) return json({ error: 'La contraseña tiene que tener al menos 6 caracteres' }, 400)

        const { data: baja, error } = await admin
          .from('bajas_de_usuarios')
          .select('user_id, email_original, reactivacion_vence_at')
          .eq('reactivacion_token', token)
          .is('reactivado_at', null)
          .maybeSingle()
        if (error) throw error
        if (!baja || !baja.reactivacion_vence_at || new Date(baja.reactivacion_vence_at).getTime() < Date.now()) {
          return json({ error: 'El link venció o ya se usó. Pedí uno nuevo desde el registro.' }, 410)
        }

        // Si la persona ya se hizo una cuenta nueva con ese mail, no se le pisa.
        const { data: otro } = await admin.rpc('auth_user_por_email', { p_email: baja.email_original })
        if (otro && otro !== baja.user_id) {
          return json({ error: 'Ya hay otra cuenta activa con ese mail. Iniciá sesión con ella o escribinos para unirlas.' }, 409)
        }

        const { error: authErr } = await admin.auth.admin.updateUserById(baja.user_id, {
          email: baja.email_original,
          email_confirm: true,
          ban_duration: 'none',
          password,
        })
        if (authErr) return json({ error: `No pudimos reactivar el acceso: ${authErr.message}` }, 500)

        const { error: rpcErr } = await admin.rpc('reactivar_perfil', { p_target: baja.user_id })
        if (rpcErr) return json({ error: `No pudimos reactivar el perfil: ${rpcErr.message}` }, 500)

        return json({ ok: true, email: baja.email_original })
      }

      default:
        return json({ error: 'Acción desconocida' }, 400)
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
