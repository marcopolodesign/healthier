import { useEffect, useState, useCallback } from 'react'

/**
 * El control común "Incluir cuentas de prueba" del super admin (ver
 * `lib/cuentasDePrueba.js`). Apagado por defecto. Se recuerda por navegador y
 * se comparte entre pantallas: si se prende en Consultas, Pagos ya abre igual.
 */
const CLAVE = 'superadmin.incluirPrueba'
const EVENTO = 'superadmin:incluir-prueba'

function leer() {
  try { return window.localStorage.getItem(CLAVE) === '1' } catch { return false }
}

export function useIncluirPrueba() {
  const [incluir, setIncluirState] = useState(leer)

  useEffect(() => {
    const sync = () => setIncluirState(leer())
    window.addEventListener(EVENTO, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENTO, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const setIncluir = useCallback((valor) => {
    try { window.localStorage.setItem(CLAVE, valor ? '1' : '0') } catch { /* sin storage: vale sólo esta pantalla */ }
    setIncluirState(Boolean(valor))
    window.dispatchEvent(new Event(EVENTO))
  }, [])

  return [incluir, setIncluir]
}
