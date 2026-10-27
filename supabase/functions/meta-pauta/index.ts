// Números de Meta Ads para el panel "Pauta" del super admin (Mateo, 2026-10-27:
// "un funnel armado tipo lo que hicimos en TAG").
//
// Sólo lectura: el token es el del system user con `ads_read` (no puede crear,
// pausar ni editar nada — lo impone Meta, no este código). Vive en los secrets
// META_ADS_READ_TOKEN / META_AD_ACCOUNT_ID y nunca sale de acá: el navegador
// recibe sólo los números ya agregados. Sólo responde a un super_admin.
//
// Devuelve, para el rango pedido:
//   - `anuncios`: una fila por anuncio (campaña + nombre de anuncio = utm_content)
//     con gasto, impresiones, clics al link y visitas a la web.
//   - `diario`: gasto por día y campaña del mes en curso (para la proyección).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const GRAPH = 'https://graph.facebook.com/v21.0'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const esFecha = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

async function insights(cuenta: string, token: string, params: Record<string, string>) {
  const filas: Record<string, unknown>[] = []
  let url: string | null = `${GRAPH}/${cuenta}/insights?` + new URLSearchParams({ ...params, limit: '500', access_token: token })
  while (url) {
    const res = await fetch(url)
    const body = await res.json()
    if (!res.ok) throw new Error(body?.error?.message ?? `Meta respondió ${res.status}`)
    filas.push(...(body.data ?? []))
    url = body.paging?.next ?? null
  }
  return filas
}

const accion = (fila: Record<string, unknown>, tipo: string) =>
  Number((fila.actions as { action_type: string; value: string }[] | undefined)?.find(a => a.action_type === tipo)?.value ?? 0)

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: { user }, error: userErr } = await anon.auth.getUser()
    if (userErr || !user) return json({ error: 'No autenticado' }, 401)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: perfil } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (perfil?.role !== 'super_admin') return json({ error: 'Sólo super_admin' }, 403)

    const token = Deno.env.get('META_ADS_READ_TOKEN')
    const cuenta = Deno.env.get('META_AD_ACCOUNT_ID')
    if (!token || !cuenta) return json({ error: 'Faltan META_ADS_READ_TOKEN / META_AD_ACCOUNT_ID en los secrets' }, 500)

    const { desde, hasta } = await req.json().catch(() => ({}))
    if (!esFecha(desde) || !esFecha(hasta)) return json({ error: 'desde/hasta tienen que ser YYYY-MM-DD' }, 400)

    const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
    const inicioMes = `${hoy.slice(0, 8)}01`

    const [porAnuncio, porDia] = await Promise.all([
      insights(cuenta, token, {
        level: 'ad',
        fields: 'campaign_id,campaign_name,ad_name,spend,impressions,inline_link_clicks,actions',
        time_range: JSON.stringify({ since: desde, until: hasta }),
      }),
      insights(cuenta, token, {
        level: 'campaign',
        fields: 'campaign_name,spend',
        time_increment: '1',
        time_range: JSON.stringify({ since: inicioMes, until: hoy }),
      }),
    ])

    return json({
      actualizado: new Date().toISOString(),
      anuncios: porAnuncio.map(f => ({
        campana: f.campaign_name,
        anuncio: f.ad_name,
        gasto: Number(f.spend ?? 0),
        impresiones: Number(f.impressions ?? 0),
        clics: Number(f.inline_link_clicks ?? 0),
        visitas: accion(f, 'landing_page_view'),
      })),
      diario: porDia.map(f => ({ fecha: f.date_start, campana: f.campaign_name, gasto: Number(f.spend ?? 0) })),
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
