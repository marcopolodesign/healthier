// ── La firma ológrafa del profesional (migración 154), para `firmabase64` ─────
// NUNCA tira: si no hay firma, si la lectura falla o si está truncada devuelve
// `null`. Quien emite corta con RCTA_FIRMA_FALTANTE ante `null` — un fallo de la
// base se presenta como "te falta la firma", que es el lado seguro para
// equivocarse (una receta emitida no se deshace).
//
// El `replace` del prefijo `data:` es defensivo y NO redundante: con el data-URL
// el servicio contesta 200 y no dibuja nada.
// ─────────────────────────────────────────────────────────────────────────────

export async function resolverFirma(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  professionalId: string | null | undefined,
): Promise<string | null> {
  try {
    if (!professionalId) return null
    const { data, error } = await supabase
      .from('professional_signatures')
      .select('firma_png')
      .eq('user_id', professionalId)
      .maybeSingle()
    if (error) {
      console.error('rcta: firma omitida — error al leerla:', error.message)
      return null
    }
    const crudo = String(data?.firma_png ?? '').replace(/^data:image\/\w+;base64,/, '').trim()
    if (crudo.length < 100) {
      if (crudo.length) console.error('rcta: firma omitida — guardada vacía o truncada')
      return null
    }
    return crudo
  } catch (err) {
    console.error('rcta: firma omitida — error al resolverla:', String(err))
    return null
  }
}
