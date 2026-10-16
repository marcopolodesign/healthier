/**
 * nutriplan-receta — arma una receta sugerida para una comida del NutriPlan del
 * paciente, con Gemini del lado del servidor.
 *
 * Entrada: { comida: string, alimentos: string[] }  →  { data: { receta }, error }
 *
 * POR QUÉ ES UNA EDGE FUNCTION
 *
 * El botón "Ver receta" de `src/pages/patient/NutriPlan.jsx` llamaba a Gemini
 * desde el navegador con `VITE_GEMINI_API_KEY`. Todo `VITE_*` se compila dentro
 * del bundle, así que la clave queda pública. Ahora la clave es el secret
 * `GEMINI_API_KEY` de Supabase (el mismo que usa `biovisor-extract`) y la
 * función exige la sesión del usuario.
 *
 * El prompt vive acá, no en el cliente: si el cliente mandara el texto, la
 * función sería un proxy abierto a Gemini para cualquiera con una cuenta.
 * El cliente sólo manda el nombre de la comida y los alimentos, con tope de
 * largo.
 */

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const MAX_ALIMENTOS = 30
const MAX_LARGO = 80

/** Saca saltos de línea y comillas: el texto entra adentro del prompt. */
const limpiar = (v: unknown) =>
  String(v ?? '').replace(/[\r\n"`]+/g, ' ').trim().slice(0, MAX_LARGO)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ data: null, error: 'Method not allowed' }, 405)

  try {
    if (!GEMINI_API_KEY) {
      return json({ data: null, error: 'GEMINI_API_KEY no está configurada en el proyecto' }, 500)
    }

    // Sólo usuarios logueados: sin esto la función sería Gemini gratis para
    // cualquiera que tenga la URL.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ data: null, error: 'Unauthorized' }, 401)

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return json({ data: null, error: 'Unauthorized' }, 401)

    const body = await req.json().catch(() => ({})) as { comida?: unknown; alimentos?: unknown }
    const comida = limpiar(body.comida) || 'una comida'
    const alimentos = (Array.isArray(body.alimentos) ? body.alimentos : [])
      .map(limpiar)
      .filter(Boolean)
      .slice(0, MAX_ALIMENTOS)
    if (!alimentos.length) return json({ data: null, error: 'Faltan los alimentos de la comida' }, 400)

    const prompt = `Inventá una receta saludable para ${comida} usando estos ingredientes: ${alimentos.join(', ')}. Respondé en español argentino. Formato: nombre del plato, tiempo de preparación, y pasos numerados. Texto plano: sin markdown, sin asteriscos ni numerales. Máximo 200 palabras.`

    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 700,
          // Igual que en biovisor-extract: en Gemini 2.5 el razonamiento se
          // descuenta de maxOutputTokens y la receta sale cortada si piensa.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    })

    if (!res.ok) {
      console.error('nutriplan-receta: Gemini', res.status, (await res.text()).slice(0, 300))
      return json({ data: null, error: `No pudimos generar la receta (Gemini ${res.status})` }, 502)
    }
    const payload = await res.json()
    const receta = payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!receta) return json({ data: null, error: 'La receta volvió vacía' }, 502)
    return json({ data: { receta }, error: null })
  } catch (err) {
    console.error('nutriplan-receta error:', err)
    return json({ data: null, error: err instanceof Error ? err.message : 'Error interno' }, 500)
  }
})
