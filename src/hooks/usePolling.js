import { useEffect, useRef } from 'react'

/**
 * Llama a `fn` cada `ms`, pero sólo mientras la pestaña esté visible.
 *
 * Existe porque el patrón se escribió tres veces a mano (el banner de turno
 * activo, el seguimiento del pedido y la tarjeta del pedido en el inicio) y
 * ninguna de las copias frenaba con la pestaña en segundo plano: un pedido
 * abierto en una pestaña de fondo le seguía pegando a la base cada 20
 * segundos toda la tarde, para nadie.
 *
 * Al volver a primer plano refresca una vez en el acto, en vez de esperar el
 * próximo tick — que es justo lo que quiere quien vuelve a mirar.
 */
export function usePolling(fn, ms) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let timer = null

    const arrancar = () => {
      if (timer) return
      timer = setInterval(() => fnRef.current(), ms)
    }
    const frenar = () => {
      if (!timer) return
      clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.hidden) { frenar(); return }
      fnRef.current()
      arrancar()
    }

    fnRef.current()
    if (!document.hidden) arrancar()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      frenar()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ms])
}
