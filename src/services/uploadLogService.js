import { supabase } from '../lib/supabase'

/**
 * Deja constancia de cada intento de subir un documento del legajo — entrara o
 * no. Lo lee el super admin en `/super-admin/subidas`.
 *
 * ── Por qué lo escribe el browser ───────────────────────────────────────────
 * Porque **la mitad de los rechazos que importan nunca llegan a la red**: el
 * archivo vacío, el que el teléfono no puede leer y el que pasa los 10 MB se
 * atajan en el cliente, así que ningún servidor se entera y no queda rastro en
 * ningún log. Los que sí salen tampoco alcanzan: los logs de Storage duran
 * pocos días y su 400 no dice el motivo.
 *
 * ── Nunca puede tumbar una subida ───────────────────────────────────────────
 * Todo esto es telemetría. Si la fila no se puede escribir —sin red, RLS,
 * sesión vencida— se traga el error en silencio: que no se registre un intento
 * es molesto; que un profesional no pueda mandar el legajo porque falló el
 * registro sería absurdo.
 */

/**
 * De un mensaje de error a una palabra con la que se pueda agrupar. El texto
 * completo se guarda igual en `detalle`, así que un motivo nuevo que hoy caiga
 * en 'otro' se descubre leyendo esa columna.
 */
export function motivoDe(err) {
  const m = (err?.message || '').toLowerCase()
  if (m.includes('máximo') || m.includes('10 mb') || m.includes('pesa')) return 'muy_grande'
  if (m.includes('vacío') || m.includes('0 kb')) return 'vacio'
  if (m.includes('no pudimos leer') || m.includes('se cortó al leerlo')) return 'ilegible'
  if (m.includes('formato') || m.includes('reconocer ese archivo')) return 'formato'
  if (m.includes('sesión')) return 'sesion'
  if (m.includes('conexión') || m.includes('señal') || m.includes('tardó demasiado')) return 'red'
  return 'otro'
}

export const uploadLogService = {
  /** El intento entró. */
  async ok(usuarioId, documento, file, bucket = 'professional-docs') {
    await registrar({ usuarioId, documento, bucket, estado: 'ok', file })
  },

  /** El intento rebotó. `err` es el error que vio la persona. */
  async rechazado(usuarioId, documento, file, err, bucket = 'professional-docs') {
    await registrar({
      usuarioId, documento, bucket, estado: 'rechazado', file,
      motivo: motivoDe(err),
      // Se recorta: el mensaje es para agrupar y para descubrir motivos nuevos,
      // no para leerlo entero en una tabla.
      detalle: (err?.message || '').slice(0, 300),
    })
  },
}

async function registrar({ usuarioId, documento, bucket, estado, file, motivo = null, detalle = null }) {
  if (!usuarioId) return
  try {
    await supabase.from('upload_log').insert({
      usuario_id: usuarioId,
      documento,
      bucket,
      estado,
      motivo,
      detalle,
      bytes: file?.size ?? null,
      mime: file?.type || null,
    })
  } catch { /* telemetría: nunca frena una subida */ }
}
