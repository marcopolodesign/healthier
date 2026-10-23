import { useCallback, useRef, useState } from 'react'
import { toast } from '../components/Toast'

/**
 * Botón "Conectar Mercado Pago": pide la URL de autorización CON la sesión
 * (`getUrl` es `mpService.getMpConnectUrl` o `pharmacyAdminService.getMpConnectUrl`)
 * y recién ahí navega. Antes era un `<a href>` directo a la Edge Function con
 * el id en la URL, sin sesión — el hueco del 2026-10-23.
 *
 * Dentro de la app, el WebView manda auth.mercadopago.com al browser del
 * sistema y la página se queda donde estaba: por eso `conectando` se libera
 * solo a los 10 segundos en vez de quedar trabado.
 */
export function useConectarMp(getUrl) {
  const [conectando, setConectando] = useState(false)
  const enCurso = useRef(false)

  const conectar = useCallback(async (e) => {
    e?.preventDefault?.()
    if (enCurso.current) return
    enCurso.current = true
    setConectando(true)
    const liberar = () => { enCurso.current = false; setConectando(false) }

    const { data: url, error } = await getUrl()
    if (error || !url) {
      liberar()
      toast.error(`No pudimos abrir Mercado Pago: ${error ?? 'sin enlace'}`)
      return
    }
    window.location.assign(url)
    setTimeout(liberar, 10000)
  }, [getUrl])

  return { conectar, conectando }
}
