/**
 * "Terminar turno" del operador de emergencias (migración 243).
 *
 * Supabase no revoca un access token ya emitido: tras `terminar_turno_operador`
 * la base y Auth ya no lo reconocen, pero PostgREST seguiría aceptándolo como el
 * profesional hasta que venza (1 h). Por eso la pantalla descarta la sesión en
 * el momento: cierra la sesión local y borra lo que `supabase-js` dejó guardado.
 *
 * Todo se inyecta (cliente y storage) para que el control automático lo corra
 * sin browser: `scripts/test-operador-web.mjs`.
 */
export async function descartarSesionLocal({ supabase, storage }) {
  try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* se limpia igual */ }
  try {
    const claves = []
    for (let i = 0; i < storage.length; i++) claves.push(storage.key(i))
    for (const k of claves) if (k && (k.startsWith('sb-') || k.startsWith('operador-'))) storage.removeItem(k)
  } catch { /* storage bloqueado: no hay nada que limpiar */ }
}

export async function terminarTurnoYDescartarSesion({ supabase, storage }) {
  const { error } = await supabase.rpc('terminar_turno_operador')
  // Aunque la base conteste con error se descarta igual: la persona pidió salir
  // y no puede quedar con la sesión de otro puesta. El error se devuelve.
  await descartarSesionLocal({ supabase, storage })
  return { error: error ?? null }
}
