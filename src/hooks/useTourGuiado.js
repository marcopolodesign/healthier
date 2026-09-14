import { useCallback, useEffect, useRef, useState } from 'react'
import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'

/**
 * El motor de los tours guiados de Healthier.
 *
 * Salió de `GuiaSimulacion.jsx`, que fue el primero. Cuando aparecieron el del
 * dashboard del paciente y el del profesional, la opción era copiar el mismo
 * bloque de driver.js tres veces — y tres copias del mismo tour divergen en dos
 * semanas: la que se arregla es una sola y las otras dos se quedan con el bug.
 * Acá vive todo lo que es igual en los tres; cada guía aporta sólo sus pasos.
 *
 * ── Lo que este hook decide, y por qué ──────────────────────────────────────
 *
 * **Overlay negro al 70% con el elemento recortado y el globo verde pegado a
 * él, con anterior/siguiente adentro** (pedido de Mateo). Va con **driver.js**
 * (~5 kB, sin dependencias): hace exactamente esto y se pinta por CSS, así que
 * entra con los tokens de Healthier — ver `.guia-healthier` en `src/index.css`.
 * Se descartó intro.js por licencia (AGPL o comercial) y Shepherd/react-joyride
 * por peso y por su API de estilos.
 *
 * **Lo resaltado se puede tocar, pero el paso no avanza solo**
 * (`disableActiveInteraction: false`). Se puede ir haciendo mientras se lee, y
 * el paso cambia recién con el botón. Avanzar al tocar ataría cada paso a un
 * detector propio, y un detector roto deja el tour trabado sin salida.
 *
 * **Arranca solo la primera vez** y después queda el punto de entrada
 * permanente que cada guía ofrece. Ofrecerlo cuenta como visto —se marca al
 * arrancar, ver `marcarVisto()`—: si lo cerró es porque no lo quiere, y volver
 * a abrirlo solo es exactamente lo que molesta.
 *
 * **Cada tour lleva su propia clave** — haber visto el del paciente no marca el
 * del profesional. Se guarda en `localStorage` y no en la base: es una cortesía,
 * no un dato de la persona, y no justifica una migración. Costo conocido: desde
 * otro dispositivo lo ve una vez más.
 *
 * ── Un paso que no le corresponde a alguien se SACA ─────────────────────────
 *
 * Cada paso puede declarar `aplica(ctx)`. Es la lección de la primera versión
 * del tour de la simulación: el paso del recetario apuntaba a una pestaña que
 * no existe para un psicólogo, y como driver.js **centra el globo** cuando el
 * selector no matchea, terminaba explicándole cómo emitir una receta que no
 * puede emitir nunca. Centrar el globo es la degradación correcta para un
 * elemento que *desapareció* (un botón que ya se tocó); no para uno que nunca
 * le va a corresponder. El numerador cuenta los pasos que quedan, así que
 * "Paso 3 de 7" sale solo.
 *
 * ── `listo`: no arrancar sabiendo a medias ──────────────────────────────────
 *
 * Casi todos los `ctx` salen de datos que llegan async (el legajo, el catálogo
 * de especialidades, las verticales habilitadas). Si el tour arranca antes, los
 * `aplica()` se evalúan contra un contexto vacío y se pierden pasos en silencio.
 * `listo` es la compuerta: hasta que no es `true`, no arranca solo.
 *
 * @param {object}   opciones
 * @param {string}   opciones.clave    — clave de `localStorage`, propia de este tour.
 * @param {Array}    opciones.pasos    — `{ selector?, lado?, titulo, cuerpo, aplica? }[]`.
 *                                       `cuerpo` puede ser función de `ctx`.
 * @param {object}   [opciones.ctx]    — contexto para `aplica()` y para `cuerpo()`.
 * @param {boolean}  [opciones.listo]  — `false` mientras el `ctx` esté incompleto.
 * @param {boolean}  [opciones.autoArranque] — `false` para que sólo arranque a pedido.
 * @returns {{ arrancar: () => void, corriendo: boolean, yaVisto: boolean }}
 */
export function useTourGuiado({ clave, pasos, ctx = {}, listo = true, autoArranque = true }) {
  const tourRef = useRef(null)
  const [corriendo, setCorriendo] = useState(false)
  const [yaVisto, setYaVisto] = useState(() => leerVisto(clave))
  // Ya se ofreció solo en esta visita, haya terminado o no. Ver el efecto de
  // arranque automático.
  const ofrecidoSolo = useRef(false)

  // El `ctx` se arma con un literal en cada render, así que como dependencia
  // haría que `arrancar` cambie de identidad siempre y el efecto de abajo
  // reiniciara el tour en cada pintada. Se compara por contenido.
  const ctxSerializado = JSON.stringify(ctx)

  const marcarVisto = useCallback(() => {
    setYaVisto(true)
    try { localStorage.setItem(clave, '1') } catch { /* modo privado: se vuelve a ofrecer */ }
  }, [clave])

  const arrancar = useCallback(() => {
    tourRef.current?.destroy()
    const contexto = JSON.parse(ctxSerializado)
    const aplicables = pasos.filter(p => !p.aplica || p.aplica(contexto))
    if (!aplicables.length) return

    // 🔴 Visto = **ofrecido**, y se marca acá, al arrancar (2026-09-14).
    //
    // Estaba marcado en `onDestroyed`, que suena más correcto ("lo cerró, no lo
    // quiere") y **no se cumple**: cerrando el tour con la X de driver.js el
    // hook no llega a correr, así que la clave nunca se escribía y el tour
    // volvía a abrirse solo **en cada visita al dashboard**, para siempre.
    // Verificado en el browser con una cuenta nueva: cerrar con la X deja
    // `localStorage` sin la clave.
    //
    // Atarlo al arranque no depende de ningún camino interno de driver.js y
    // deja el mismo trato: se ofrece una vez, y el punto de entrada para
    // volver a verlo está en el Centro de ayuda. El costo es que quien recarga
    // en la mitad no lo vuelve a ver solo — bastante mejor que no poder
    // sacárselo de encima.
    marcarVisto()

    const tour = driver({
      showProgress: true,
      progressText: 'Paso {{current}} de {{total}}',
      overlayColor: '#000000',
      overlayOpacity: 0.7,
      disableActiveInteraction: false,
      allowClose: true,
      popoverClass: 'guia-healthier',
      nextBtnText: 'Siguiente',
      prevBtnText: 'Anterior',
      doneBtnText: 'Terminar',
      steps: aplicables.map(p => ({
        element: p.selector,
        popover: {
          title: p.titulo,
          description: typeof p.cuerpo === 'function' ? p.cuerpo(contexto) : p.cuerpo,
          side: p.lado ?? 'bottom',
          align: p.alineacion ?? 'start',
        },
      })),
      // Ojo: con driver.js 1.8 esto NO corre al cerrar con la X — por eso lo
      // que se persiste se escribe en `marcarVisto()`, arriba. Acá queda sólo
      // el estado en memoria, que sí sirve cuando el hook llega a correr.
      onDestroyed: () => setCorriendo(false),
    })
    tourRef.current = tour
    setCorriendo(true)
    tour.drive()
  }, [clave, pasos, ctxSerializado, marcarVisto])

  // Arranque automático: **una sola vez por visita**, y sólo con el contexto
  // completo.
  //
  // 🔴 `ofrecidoSolo` no es redundante con `leerVisto` (2026-09-14). Este
  // efecto depende de `arrancar`, que cambia de identidad cada vez que cambia
  // el `ctx` — y el `ctx` del dashboard del profesional se completa de a
  // pedazos: si conectó Mercado Pago, cuál es su especialidad, si la tarjeta de
  // práctica sigue abierta. Cada uno de esos datos que llega **volvía a
  // disparar el efecto**, y 600 ms después `arrancar` destruía el tour que la
  // persona estaba leyendo y lo **empezaba de nuevo desde el paso 1**, a veces
  // con otro total ("Paso 2 de 5" → "Paso 2 de 4"). `leerVisto` no lo ataja:
  // se evalúa acá, antes de que `arrancar` marque el tour como visto al
  // destruirlo, así que el reinicio ya está en camino.
  //
  // Le pasaba justo al profesional recién registrado —el de más pasos por
  // cargar, y el único que tiene el tour sin ver— encima de la tarjeta
  // "Completá tu perfil", que es adonde lo queremos mandar.
  //
  // El ref no toca el `arrancar()` manual del Centro de ayuda: ahí sí se
  // reconstruye a pedido, que es lo que se pidió.
  useEffect(() => {
    if (!autoArranque || !listo || leerVisto(clave) || ofrecidoSolo.current) return
    // Un tick para que la pantalla ya esté pintada: driver.js mide el elemento
    // al resaltarlo, y sobre un DOM a medio montar mide mal (o no lo encuentra
    // y manda el globo al centro, que es peor porque no se nota).
    const t = setTimeout(() => {
      ofrecidoSolo.current = true
      arrancar()
    }, 600)
    return () => clearTimeout(t)
  }, [arrancar, listo, autoArranque, clave])

  useEffect(() => () => tourRef.current?.destroy(), [])

  // El recorte está anclado a coordenadas, y en varias de estas pantallas la
  // geometría se mueve SIN que haya `resize` de ventana —el divisor entre el
  // video y el panel clínico es arrastrable, las tarjetas del dashboard
  // aparecen cuando termina de cargar su fetch—. driver.js reposiciona en
  // `resize` y `scroll`, ninguno de los cuales se dispara ahí.
  useEffect(() => {
    if (!corriendo) return
    const observador = new ResizeObserver(() => tourRef.current?.refresh())
    observador.observe(document.body)
    return () => observador.disconnect()
  }, [corriendo])

  return { arrancar, corriendo, yaVisto }
}

function leerVisto(clave) {
  try { return !!localStorage.getItem(clave) } catch { return false }
}
