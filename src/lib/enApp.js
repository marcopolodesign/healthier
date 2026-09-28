/**
 * ¿Esta página está abierta dentro del WebView de la app?
 *
 * Ahí ya hay una X nativa arriba a la izquierda que vuelve a la app, y no hay
 * historia a la que volver: un "Volver" de la web queda debajo de la X y no
 * hace nada. Lo usan las pantallas que la app embebe (videollamada, atención
 * de una emergencia) para esconderlo y dejarle esa esquina a la X.
 *
 * `window.ReactNativeWebView` sólo existe si el WebView escucha mensajes, así
 * que no alcanza: la app agrega "HealthierApp" al user agent, y para las
 * versiones ya instaladas se reconoce el WebView por el UA — el de iOS no dice
 * "Safari/" (Safari y Chrome sí), el de Android lleva "; wv)".
 */
export function esWebViewDeLaApp() {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent || ''
  return !!window.ReactNativeWebView
    || ua.includes('HealthierApp')
    || (/iPhone|iPad/.test(ua) && !ua.includes('Safari/'))
    || ua.includes('; wv)')
}
