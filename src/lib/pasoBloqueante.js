import { useEffect, useState } from 'react'

/**
 * ¿Hay un paso bloqueante en pantalla (hoy: confirmar el apellido)?
 *
 * Mientras esté, el tour guiado no arranca solo: driver.js se dibuja por encima
 * de todo y lo taparía, y además lo marcaría como visto sin que nadie lo viera.
 */
let activo = false
const EVENTO = 'healthier:paso-bloqueante'

export function marcarPasoBloqueante(valor) {
  if (activo === valor) return
  activo = valor
  window.dispatchEvent(new Event(EVENTO))
}

export function usePasoBloqueante() {
  const [valor, setValor] = useState(activo)
  useEffect(() => {
    const alCambiar = () => setValor(activo)
    window.addEventListener(EVENTO, alCambiar)
    alCambiar()
    return () => window.removeEventListener(EVENTO, alCambiar)
  }, [])
  return valor
}
