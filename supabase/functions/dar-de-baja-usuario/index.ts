// dar-de-baja-usuario — "Eliminar" del super admin (migración 188).
//
// Nunca borra: un DELETE de profiles dejaba vivo el auth.users (el mail no se
// podía volver a usar) y las FK en CASCADE se llevaban parte de la historia
// clínica, que la Ley 26.529 obliga a conservar 10 años. Acá, por cada id:
//   1. `dar_de_baja_perfil` (SQL, atómico): guarda el mail real y los datos que
//      se sacan en `bajas_de_usuarios`, pasa el perfil al alias, le saca foto y
//      teléfono, marca deleted_at/deleted_by y cierra las sesiones.
//   2. Admin API de Auth: mail de auth.users al mismo alias (así se libera el
//      real) y baneo. Va por la API y no por SQL porque también actualiza
//      auth.identities.
// Si el paso 2 falla, el perfil ya quedó dado de baja; reintentar es seguro
// (el paso 1 no pisa el mail original guardado).
//
// Sólo la puede llamar un super_admin. Devuelve el resultado de cada id con el
// error real, para que el panel lo muestre tal cual.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user: caller } } = await anon.auth.getUser()
    if (!caller) return json({ error: 'No autenticado' }, 401)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: yo } = await admin.from('profiles').select('role').eq('id', caller.id).maybeSingle()
    if (yo?.role !== 'super_admin') return json({ error: 'Sólo un super admin puede dar de baja usuarios' }, 403)

    const { ids } = await req.json().catch(() => ({ ids: null }))
    if (!Array.isArray(ids) || ids.length === 0) return json({ error: 'Faltan los ids a dar de baja' }, 400)

    const resultados = []
    for (const id of ids) {
      const { data, error } = await admin.rpc('dar_de_baja_perfil', { p_target: id, p_actor: caller.id })
      if (error) { resultados.push({ id, ok: false, error: error.message }); continue }

      const { error: authErr } = await admin.auth.admin.updateUserById(id, {
        email: data.alias,
        email_confirm: true,
        ban_duration: '876000h',
      })
      // Un perfil sin auth.users (filas viejas) igual queda dado de baja.
      if (authErr && !/not.?found/i.test(authErr.message)) {
        resultados.push({ id, ok: false, error: `El perfil quedó dado de baja, pero no se pudo liberar el mail: ${authErr.message}` })
        continue
      }
      resultados.push({ id, ok: true })
    }

    const fallidos = resultados.filter(r => !r.ok)
    return json({ resultados, ok: fallidos.length === 0 }, fallidos.length === resultados.length ? 422 : 200)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
