import { useCallback, useEffect, useRef, useState } from 'react'
import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { GraduationCap, Play } from '@phosphor-icons/react'
import { CODIGO_DE_CIERRE } from '../../lib/simulacion'

/**
 * La franja de práctica y el tour guiado de la simulación de videollamada.
 *
 * ── El tour ─────────────────────────────────────────────────────────────────
 *
 * Overlay negro al 70% con el elemento del paso recortado, y el texto en un
 * globo verde pegado a ese elemento con anterior/siguiente adentro. Va con
 * **driver.js** (~5 kB, sin dependencias): hace exactamente esto y se pinta por
 * CSS, así que entra con los tokens de Healthier — ver `.guia-healthier` en
 * `src/index.css`. Se descartó intro.js por licencia (AGPL/comercial) y
 * Shepherd/Joyride por peso y por su API de estilos.
 *
 * **Lo resaltado se puede tocar, pero el paso no avanza solo**
 * (`disableActiveInteraction: false`, decisión de Mateo): se puede ir haciendo
 * mientras se lee, y el paso cambia recién con el botón. Avanzar solo al tocar
 * ataría cada paso a un detector propio, y un detector roto deja el tour
 * trabado sin salida.
 *
 * ── El problema que este tour tiene y otros no ──────────────────────────────
 *
 * El recorte se ancla a coordenadas, y acá la geometría se mueve debajo: el
 * profesional **arrastra el divisor** entre el video y el panel clínico, y en
 * mobile la Historia Clínica sube como una hoja. driver.js reposiciona solo en
 * `resize` y `scroll`, pero arrastrar el divisor no dispara ninguno de los dos
 * — por eso el `ResizeObserver` de abajo.
 *
 * ── Los pasos dependen de la vertical ───────────────────────────────────────
 *
 * **Sólo recetan las especialidades habilitadas** (`puede_recetar`, migración
 * 116: hoy clínica y pediatría). Al psicólogo no hay que **explicarle** cómo
 * recetar: la pestaña no existe para él, y dejar el paso hacía que driver.js
 * centrara el globo y le enseñara algo que no puede hacer nunca. El paso se
 * saca, no se muestra sin foco. Lo mismo al revés con NutriPlan, que es de
 * nutrición y de nadie más.
 *
 * Cada paso declara un `aplica(ctx)`; el numerador de driver.js cuenta los que
 * quedan, así que "Paso 3 de 7" sale solo.
 *
 * ── Un paso sin elemento sí es válido ───────────────────────────────────────
 *
 * Distinto del caso de arriba: "Dejala entrar" apunta a un botón que desaparece
 * una vez que la habilitó, y la bienvenida no señala nada. driver.js centra el
 * globo cuando el selector no matchea, que es la degradación correcta — el paso
 * se sigue leyendo, sin foco.
 */

const CLAVE_VISTA = 'healthier:guia-simulacion-vista'

const PASOS = [
  {
    // Sin `element`: es la bienvenida, no señala nada. El globo va al centro.
    titulo: 'Esto es una práctica',
    cuerpo: 'La paciente no existe y nada de lo que hagas acá se guarda: ni la historia clínica, ni las notas, ni la consulta. Podés equivocarte todas las veces que quieras.',
  },
  {
    selector: '[data-tour="preconsulta"]',
    lado: 'left',
    titulo: 'Mirá con qué llega',
    // El motivo de la paciente simulada cambia según la vertical (ver
    // `PRECONSULTAS` en `lib/simulacion.js`), así que el texto no puede
    // nombrarlo: diría "dolor de garganta" en una consulta de psicología.
    cuerpo: 'Antes de entrar, la paciente completa un cuestionario. Acá tenés su motivo, sus síntomas y desde cuándo, para no arrancar preguntándole lo que ya contestó.',
  },
  {
    selector: '[data-tour="ingresar-paciente"]',
    lado: 'right',
    titulo: 'Dejala entrar',
    cuerpo: 'Está en la sala de espera y no puede entrar hasta que la habilites. Tocá el botón. Es el paso que más dudas genera: hasta que no lo tocás, del otro lado el botón está gris.',
  },
  {
    selector: '[data-tour="tab-historia"]',
    lado: 'bottom',
    titulo: 'Revisá los antecedentes',
    cuerpo: ({ receta }) => receta
      ? 'Acá está lo que le pasó antes. Miralo ahora, no después de recetar: hay una alergia cargada que choca con lo primero que uno recetaría para una angina.'
      : 'Acá está lo que le pasó antes: consultas previas, diagnósticos y alergias. Conviene mirarlo antes de decidir nada.',
  },
  {
    selector: '[data-tour="botones-nota"]',
    lado: 'left',
    titulo: 'Cargá la consulta',
    cuerpo: 'Escribí lo que encontrás: síntomas, signos vitales y el diagnóstico, que se busca por nombre y queda con su código. En una consulta real esto queda firmado con tu matrícula y no se puede borrar.',
  },
  {
    // Sólo para quien puede recetar de verdad. Ver la nota de arriba.
    aplica: ({ receta }) => receta,
    selector: '[data-tour="tab-receta"]',
    lado: 'bottom',
    titulo: 'Recetá',
    cuerpo: 'Buscá el medicamento en el vademécum y emitila: vas a recibir el PDF de verdad. En la práctica sale contra el ambiente de pruebas, así que no tiene validez legal y no le llega a nadie.',
  },
  {
    aplica: ({ especialidad }) => especialidad === 'nutricion',
    selector: '[data-tour="nutriplan"]',
    lado: 'left',
    titulo: 'Armale el plan',
    cuerpo: 'Desde acá abrís NutriPlan Pro con esta paciente ya cargada, para armarle o editarle el plan de alimentación. Es tuyo, de nutrición: el resto de las verticales no lo tiene.',
  },
  {
    selector: '[data-tour="tab-cerrar"]',
    lado: 'bottom',
    titulo: 'Cerrá la consulta',
    cuerpo: `Al terminar, la paciente te dicta un código de 4 dígitos para confirmar que la atendiste. En la práctica es ${CODIGO_DE_CIERRE} — probá poner uno equivocado primero, para ver qué pasa.`,
  },
  {
    titulo: 'Listo',
    cuerpo: 'Ese es todo el recorrido. Quedate practicando lo que quieras: cuando tengas una consulta real, la pantalla es exactamente ésta.',
  },
]

export default function GuiaSimulacion({ especialidad, puedeRecetar = false, listo = true }) {
  const tourRef = useRef(null)
  const [corriendo, setCorriendo] = useState(false)

  const arrancar = useCallback(() => {
    tourRef.current?.destroy()
    const ctx = { especialidad, receta: puedeRecetar }
    const pasos = PASOS.filter(p => !p.aplica || p.aplica(ctx))
    const tour = driver({
      showProgress: true,
      progressText: 'Paso {{current}} de {{total}}',
      overlayColor: '#000000',
      overlayOpacity: 0.7,
      // Se puede tocar lo resaltado; el paso avanza con los botones.
      disableActiveInteraction: false,
      allowClose: true,
      popoverClass: 'guia-healthier',
      nextBtnText: 'Siguiente',
      prevBtnText: 'Anterior',
      doneBtnText: 'Terminar',
      steps: pasos.map(p => ({
        element: p.selector,
        popover: {
          title: p.titulo,
          description: typeof p.cuerpo === 'function' ? p.cuerpo(ctx) : p.cuerpo,
          side: p.lado ?? 'bottom',
          align: 'start',
        },
      })),
      onDestroyed: () => {
        setCorriendo(false)
        try { localStorage.setItem(CLAVE_VISTA, '1') } catch { /* modo privado: se vuelve a ofrecer */ }
      },
    })
    tourRef.current = tour
    setCorriendo(true)
    tour.drive()
  }, [especialidad, puedeRecetar])

  // Arranca solo la primera vez. Después queda el botón de la franja: el que ya
  // la hizo viene a practicar, no a leerla otra vez.
  useEffect(() => {
    // `listo` = ya sabemos si esta especialidad receta. Sin esperarlo, el tour
    // arrancaría mientras el catálogo de especialidades todavía viene en
    // camino: `puedeRecetar` devuelve `false` mientras carga, y un clínico se
    // quedaría sin el paso del recetario.
    if (!listo) return
    let vista = false
    try { vista = !!localStorage.getItem(CLAVE_VISTA) } catch { /* se trata como no vista */ }
    if (!vista) {
      // Un tick para que el panel clínico ya esté montado: driver.js mide el
      // elemento al resaltarlo, y sobre un DOM a medio pintar mide mal.
      const t = setTimeout(arrancar, 600)
      return () => clearTimeout(t)
    }
  }, [arrancar, listo])

  useEffect(() => () => tourRef.current?.destroy(), [])

  // El recorte está anclado a coordenadas y acá la geometría se mueve sin que
  // haya `resize` de ventana: el divisor entre el video y el panel es
  // arrastrable, y en mobile la Historia Clínica sube como hoja. Sin esto, el
  // agujero del overlay queda apuntando al lugar donde el elemento estaba.
  useEffect(() => {
    if (!corriendo) return
    const observador = new ResizeObserver(() => tourRef.current?.refresh())
    observador.observe(document.body)
    return () => observador.disconnect()
  }, [corriendo])

  return (
    <div className="shrink-0 flex items-center gap-3 bg-brand px-4 py-1.5 text-white">
      {/* La franja no se puede cerrar: el panel es idéntico al real, y quien
          vuelve a la pestaña diez minutos después no tiene otra forma de saber
          que la paciente no existe. */}
      <GraduationCap weight="fill" className="h-4 w-4 shrink-0" />
      <span className="text-xs font-semibold uppercase tracking-wide">Modo práctica</span>
      <span className="hidden text-xs text-white/70 sm:inline">· paciente de mentira, no se guarda nada</span>
      <button
        onClick={arrancar}
        className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium transition-colors hover:bg-white/25"
      >
        <Play weight="fill" className="h-3 w-3" /> Ver la guía
      </button>
    </div>
  )
}
