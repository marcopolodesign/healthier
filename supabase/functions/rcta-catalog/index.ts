// rcta-catalog — proxy de solo lectura a los catálogos de Innovamed (QBI2).
//
// Por qué existe: los autocompletados de medicamento y de financiador tienen que
// consultar la API de Innovamed, pero el token vive en Supabase secrets y no
// puede viajar al navegador — cualquier `VITE_*` se compila en el bundle y es
// público, y este token firma recetas legalmente válidas.
//
// Reglas de la integración que este archivo respeta (ver docs/rcta-buenas-practicas.md):
//  · `clienteAppId` va como query param en los GET.
//  · `RCTA_API_URL` no lleva barra final; acá se le agrega `/apirecipe/...`.
//  · Solo lectura: este proxy no emite ni modifica nada. Emitir es `rcta-issue`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // ── Cualquier usuario autenticado; el vademécum sigue siendo del médico ──
    // El catálogo no es secreto, pero el token que lo consulta sí: sin esta
    // guarda, cualquiera podría usar nuestra cuota de Innovamed. Alcanza con
    // exigir sesión.
    //
    // Antes exigía rol profesional y eso rompía dos pantallas del paciente que
    // necesitan catálogos que no tienen nada de clínico: elegir la obra social
    // en el onboarding (financiadores) y decir qué estudio subió al BioVisor
    // (prácticas). Le devolvía 403 y el buscador quedaba mudo.
    //
    // `medicamentos` sí sigue siendo sólo del profesional, más abajo: es el
    // vademécum con el que se prescribe.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'No autorizado' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: 'No autorizado' }, 401)

    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (!profile) return json({ error: 'No autorizado' }, 401)

    const RCTA_API_URL = Deno.env.get('RCTA_API_URL')
    const RCTA_API_KEY = Deno.env.get('RCTA_API_KEY')
    const RCTA_CLIENT_APP_ID = Deno.env.get('RCTA_CLIENT_APP_ID')
    if (!RCTA_API_URL || !RCTA_API_KEY || !RCTA_CLIENT_APP_ID) {
      return json({ error: 'RCTA no configurado', code: 'RCTA_NOT_CONFIGURED' }, 503)
    }

    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    const call = async (path: string, params: Record<string, string | null> = {}) => {
      const qs = new URLSearchParams({ clienteAppId: RCTA_CLIENT_APP_ID })
      for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
      const res = await fetch(`${RCTA_API_URL}/apirecipe/${path}?${qs}`, {
        headers: { Authorization: `Bearer ${RCTA_API_KEY}` },
      })
      const text = await res.text()
      if (!res.ok) {
        // El texto crudo de Innovamed es lo único que a veces explica el error
        // (los códigos QBI vienen ahí). Se propaga sin envolver.
        return json({ error: 'Innovamed rechazó la consulta', status: res.status, detail: text.slice(0, 500) }, 502)
      }
      return new Response(text, { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    if (action === 'financiadores') {
      return await call('GetFinanciadores')
    }

    if (action === 'medicamentos') {
      // El vademécum es la herramienta de prescribir: no la abre un paciente.
      if (!['professional', 'admin', 'super_admin'].includes(profile.role)) {
        return json({ error: 'Solo profesionales pueden consultar el vademécum' }, 403)
      }
      const search = (url.searchParams.get('search') ?? '').trim()
      // Menos de 3 caracteres devuelve medio catálogo y no sirve para elegir.
      if (search.length < 3) return json({ medicamentos: [], pageInfo: null })
      return await call(`GetMedicamento/${encodeURIComponent(search)}`, {
        numeroPagina: url.searchParams.get('numeroPagina') ?? '1',
        // Opcionales: con financiador + afiliado, Innovamed devuelve además si
        // ese medicamento tiene cobertura para ESE paciente.
        idFinanciador: url.searchParams.get('idFinanciador'),
        afiliadoCredencial: url.searchParams.get('afiliadoCredencial'),
      })
    }

    if (action === 'practicas') {
      // Catálogo de prácticas y estudios de Innovamed. Lo usa el BioVisor para
      // que el paciente diga QUÉ estudio subió eligiéndolo de una lista real, en
      // vez de escribir "análisis" y que después nadie sepa de qué se trata.
      // A diferencia de los medicamentos, acá el código NO es obligatorio: no hay
      // ninguna API del otro lado rechazando el texto libre, y un estudio raro
      // que no esté en el catálogo no puede bloquear al paciente.
      const search = (url.searchParams.get('search') ?? '').trim()
      if (search.length < 3) return json({ practicas: [], pageInfo: null })
      return await call('GetPracticas', {
        search,
        numeroPagina: url.searchParams.get('numeroPagina') ?? '1',
        tipo: url.searchParams.get('tipo'),
        categoria: url.searchParams.get('categoria'),
      })
    }

    return json({ error: 'action inválida — usar "medicamentos", "financiadores" o "practicas"' }, 400)
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
