import { supabase } from '../lib/supabase'

/**
 * Catálogos de Innovamed (RCTA), a través de la Edge Function `rcta-catalog`.
 *
 * No se le pega a Innovamed directo desde el navegador: el token vive en
 * Supabase secrets y cualquier `VITE_*` termina compilada en el bundle. Este
 * token firma recetas legalmente válidas.
 *
 * La regla que estos métodos existen para cumplir: **la API rechaza texto libre
 * donde espera un código de su catálogo**. Ver `docs/rcta-buenas-practicas.md`.
 */

async function callCatalog(params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rcta-catalog?${qs}`,
    { headers: { Authorization: `Bearer ${session?.access_token}` } },
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Error consultando el catálogo (${res.status})`)
  }
  return res.json()
}

export const rctaService = {
  /**
   * Busca medicamentos. Devuelve el `regNo`, que es el dato que hay que guardar
   * — sin él la receta se rechaza con QBI105.
   *
   * Con `idFinanciador` + `afiliado`, Innovamed además dice si ese medicamento
   * tiene cobertura para ESE paciente (`tieneCobertura`).
   */
  async buscarMedicamentos(search, { idFinanciador = null, afiliado = null } = {}) {
    const d = await callCatalog({
      action: 'medicamentos',
      search,
      idFinanciador,
      afiliadoCredencial: afiliado,
    })
    return d.medicamentos ?? []
  },

  /** Catálogo completo de financiadores (~900). Cambia con el tiempo: nunca hardcodear ids. */
  async listarFinanciadores() {
    const d = await callCatalog({ action: 'financiadores' })
    return d.financiadores ?? []
  },
}
