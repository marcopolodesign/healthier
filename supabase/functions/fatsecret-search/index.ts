/**
 * fatsecret-search — busca alimentos en FatSecret, del lado del servidor.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * La búsqueda de alimentos del NutriPlan del profesional se hacía desde el
 * browser, y estaba rota por DOS razones a la vez:
 *
 *   1. **El proxy murió.** El navegador no puede llamar a FatSecret directo
 *      (no manda CORS), así que la llamada pasaba por `corsproxy.io` sin clave.
 *      Ese servicio dejó de aceptar URLs anónimas y hoy devuelve
 *      `403 keyless_legacy_url`. O sea: toda búsqueda fallaba.
 *   2. **Las credenciales estaban en el bundle.** `FS_CLIENT_ID` y
 *      `FS_CLIENT_SECRET` vivían como constantes en `nutriplanService.js`, o
 *      sea compiladas dentro del JavaScript público. Cualquiera con el sitio
 *      abierto podía leerlas y gastar nuestra cuota.
 *
 * Las dos se arreglan igual: la llamada se hace acá, con las credenciales como
 * secretos de Supabase.
 *
 * ── Lo que esta función NO puede arreglar sola ──────────────────────────────
 *
 * La cuenta de FatSecret tiene **restricción por IP**: el endpoint de búsqueda
 * responde `{"error":{"code":21,"message":"Invalid IP address detected"}}` a
 * cualquier IP que no esté en la lista blanca de su panel. Las Edge Functions de
 * Supabase NO tienen IP de salida fija, así que no se pueden dar de alta ahí.
 *
 * Hasta que eso se resuelva en el panel de FatSecret, la función devuelve
 * `{ results: [], motivo: 'ip_no_habilitada' }` y el front cae al vademécum
 * local. Se devuelve 200 con un motivo, no un 500: para el profesional no es un
 * error del sistema, es "esta fuente no está disponible", y tiene que poder
 * seguir armando el plan igual.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CLIENT_ID = Deno.env.get('FATSECRET_CLIENT_ID')
const CLIENT_SECRET = Deno.env.get('FATSECRET_CLIENT_SECRET')

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token'
const API_URL = 'https://platform.fatsecret.com/rest/server.api'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// El token dura una hora larga; se cachea en memoria de la instancia para no
// pedir uno nuevo en cada tecla del buscador.
let token: string | null = null
let tokenVence = 0

async function getToken(): Promise<string> {
  if (token && Date.now() < tokenVence) return token
  const cred = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${cred}`,
    },
    body: 'grant_type=client_credentials&scope=basic',
  })
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`)
  const data = await res.json()
  token = data.access_token
  tokenVence = Date.now() + (data.expires_in * 1000) - 60_000
  return token!
}

/** La descripción viene como texto ("Calories: 250kcal | Fat: 12g | ..."). */
function parsearMacros(desc: string) {
  const num = (re: RegExp) => {
    const m = desc.match(re)
    return m ? parseFloat(m[1]) : 0
  }
  return {
    calories: Math.round(num(/Calories:\s*([\d.]+)/i) || num(/Calorías:\s*([\d.]+)/i)),
    protein: Math.round((num(/Protein:\s*([\d.]+)/i) || num(/Prot(?:eínas?)?:\s*([\d.]+)/i)) * 10) / 10,
    carbs: Math.round((num(/Carbs:\s*([\d.]+)/i) || num(/Carboh?:\s*([\d.]+)/i) || num(/Hidratos:\s*([\d.]+)/i)) * 10) / 10,
    fat: Math.round((num(/Fat:\s*([\d.]+)/i) || num(/Grasas?:\s*([\d.]+)/i)) * 10) / 10,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return json({ results: [], motivo: 'no_configurado' })
  }

  try {
    const { query } = await req.json()
    if (!query || !String(query).trim()) return json({ results: [] })

    const t = await getToken()
    const params = new URLSearchParams({
      method: 'foods.search',
      search_expression: String(query).trim(),
      format: 'json',
      page_number: '0',
      max_results: '20',
      language: 'es',
      region: 'AR',
    })

    const res = await fetch(`${API_URL}?${params}`, { headers: { Authorization: `Bearer ${t}` } })
    const data = await res.json()

    // FatSecret contesta 200 con un `error` adentro. El 21 es el de la lista
    // blanca de IPs, y es el que hoy nos frena: se distingue del resto para que
    // el front pueda decir algo útil en vez de "falló la búsqueda".
    if (data?.error) {
      const codigo = Number(data.error.code)
      console.error(`fatsecret error ${codigo}: ${data.error.message}`)
      return json({ results: [], motivo: codigo === 21 ? 'ip_no_habilitada' : 'error_proveedor' })
    }

    const crudos = data?.foods?.food
    if (!crudos) return json({ results: [] })
    const lista = Array.isArray(crudos) ? crudos : [crudos]

    return json({
      results: lista.map((f: Record<string, string>) => ({
        id: `fs_${f.food_id}`,
        name: f.food_name || 'Sin nombre',
        brand: f.brand_name || null,
        category: f.food_type === 'Brand' ? 'Marca' : 'Genérico',
        ...parsearMacros(f.food_description || ''),
        fiber: 0,
        isExternal: true,
      })),
    })
  } catch (err) {
    console.error('fatsecret-search:', err instanceof Error ? err.message : err)
    return json({ results: [], motivo: 'error_proveedor' })
  }
})
