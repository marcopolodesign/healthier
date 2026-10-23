/**
 * buscar-alimentos — busca alimentos en Open Food Facts, del lado del servidor.
 *
 * ── Por qué Open Food Facts y no FatSecret ──────────────────────────────────
 *
 * Hasta el 2026-10-23 esto era `fatsecret-search`. FatSecret exige una lista
 * blanca de IPs por cuenta y las Edge Functions de Supabase no tienen IP de
 * salida fija, así que la búsqueda nunca anduvo desde acá (contestaba
 * `Invalid IP address detected`). Open Food Facts es abierta: sin clave, sin
 * restricción de IP, y con buena cobertura de productos argentinos.
 *
 * Se usa el buscador nuevo (`search.openfoodfacts.org`, "search-a-licious"):
 * el viejo `cgi/search.pl` tiene un límite de 10 búsquedas por minuto y se
 * vuelve lento. Open Food Facts pide un User-Agent que identifique la app.
 *
 * ── Qué se filtra ───────────────────────────────────────────────────────────
 *
 * La base la carga la comunidad, así que muchos productos no tienen tabla
 * nutricional o tienen el código de barras como nombre. Se descartan los que no
 * traen calorías por 100 g o un nombre legible, y se ordenan primero los que se
 * venden en Argentina y los que tienen la búsqueda en el nombre.
 *
 * La respuesta es la misma de antes — `{ results, motivo? }`, 200 siempre — para
 * que el front caiga al vademécum local si la fuente externa no responde.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const API_URL = 'https://search.openfoodfacts.org/search'
const USER_AGENT = 'Healthier/1.0 (https://www.healthier.com.ar)'
const CAMPOS = 'code,product_name,product_name_es,brands,countries_tags,nutriments'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const redondear = (n: unknown) => Math.round((Number(n) || 0) * 10) / 10

/** Minúsculas y sin tildes, para comparar "Yogúr" con "yogur". */
const normalizar = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

type Producto = {
  code?: string
  product_name?: string
  product_name_es?: string
  brands?: string | string[]
  countries_tags?: string[]
  nutriments?: Record<string, number>
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { query } = await req.json()
    const q = String(query ?? '').trim()
    if (!q) return json({ results: [] })

    const params = new URLSearchParams({ q, page_size: '50', langs: 'es', fields: CAMPOS })
    const res = await fetch(`${API_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.error(`openfoodfacts ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return json({ results: [], motivo: 'error_proveedor' })
    }
    const data = await res.json()
    const hits: Producto[] = data?.hits ?? []

    const palabras = normalizar(q).split(/\s+/).filter(Boolean)
    const vistos = new Set<string>()

    const candidatos = hits.flatMap((p) => {
      const n = p.nutriments ?? {}
      const kcal = Number(n['energy-kcal_100g'])
      const nombre = (p.product_name_es || p.product_name || '').trim()
      // Sin calorías no le sirve al nutricionista; un nombre que es sólo dígitos
      // es el código de barras cargado en el campo equivocado.
      if (!kcal || !nombre || /^\d+$/.test(nombre)) return []

      const marca = Array.isArray(p.brands) ? p.brands[0] : p.brands?.split(',')[0]
      const clave = normalizar(`${nombre}|${marca ?? ''}`)
      if (vistos.has(clave)) return []
      vistos.add(clave)

      const nombreNorm = normalizar(nombre)
      const puntaje =
        (p.countries_tags?.includes('en:argentina') ? 2 : 0) +
        (palabras.every((w) => nombreNorm.includes(w)) ? 1 : 0)

      return [{
        puntaje,
        food: {
          id: `off_${p.code}`,
          name: nombre,
          brand: marca?.trim() || null,
          category: marca ? 'Marca' : 'Genérico',
          calories: Math.round(kcal),
          protein: redondear(n.proteins_100g),
          carbs: redondear(n.carbohydrates_100g),
          fat: redondear(n.fat_100g),
          fiber: redondear(n.fiber_100g),
          isExternal: true,
        },
      }]
    })

    // sort es estable: a igual puntaje queda el orden de relevancia de OFF.
    candidatos.sort((a, b) => b.puntaje - a.puntaje)
    return json({ results: candidatos.slice(0, 20).map((c) => c.food) })
  } catch (err) {
    console.error('buscar-alimentos:', err instanceof Error ? err.message : err)
    return json({ results: [], motivo: 'error_proveedor' })
  }
})
