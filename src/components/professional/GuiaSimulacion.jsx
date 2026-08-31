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
 * ── Un paso sin elemento no es un error ─────────────────────────────────────
 *
 * "Recetá" apunta a una pestaña que **no existe** para un psicólogo (sólo
 * recetan las especialidades habilitadas), y "Dejala entrar" apunta a un botón
 * que desaparece una vez que entró. driver.js centra el globo cuando el
 * selector no matchea, que es la degradación correcta: el paso se sigue
 * leyendo, sin foco. Nada que detectar ni que saltear.
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
    cuerpo: 'Antes de entrar, la paciente completa un cuestionario. Acá tenés su motivo, sus síntomas y desde cuándo: dolor de garganta y fiebre hace 3 días.',
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
    cuerpo: 'Acá está lo que le pasó antes. Miralo ahora, no después de recetar: hay una alergia cargada que choca con lo primero que uno recetaría para una angina.',
  },
  {
    selector: '[data-tour="botones-nota"]',
    lado: 'left',
    titulo: 'Cargá la consulta',
    cuerpo: 'Escribí lo que encontrás: síntomas, signos vitales y el diagnóstico, que se busca por nombre y queda con su código. En una consulta real esto queda firmado con tu matrícula y no se puede borrar.',
  },
  {
    selector: '[data-tour="tab-receta"]',
    lado: 'bottom',
    titulo: 'Recetá',
    cuerpo: 'Buscá el medicamento en el vademécum y emitila: vas a recibir el PDF de verdad. En la práctica sale contra el ambiente de pruebas, así que no tiene validez legal y no le llega a nadie.',
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

export default function GuiaSimulacion() {
  const tourRef = useRef(null)
  const [corriendo, setCorriendo] = useState(false)

  const arrancar = useCallback(() => {
    tourRef.current?.destroy()
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
      steps: PASOS.map(p => ({
        element: p.selector,
        popover: { title: p.titulo, description: p.cuerpo, side: p.lado ?? 'bottom', align: 'start' },
      })),
      onDestroyed: () => {
        setCorriendo(false)
        try { localStorage.setItem(CLAVE_VISTA, '1') } catch { /* modo privado: se vuelve a ofrecer */ }
      },
    })
    tourRef.current = tour
    setCorriendo(true)
    tour.drive()
  }, [])

  // Arranca solo la primera vez. Después queda el botón de la franja: el que ya
  // la hizo viene a practicar, no a leerla otra vez.
  useEffect(() => {
    let vista = false
    try { vista = !!localStorage.getItem(CLAVE_VISTA) } catch { /* se trata como no vista */ }
    if (!vista) {
      // Un tick para que el panel clínico ya esté montado: driver.js mide el
      // elemento al resaltarlo, y sobre un DOM a medio pintar mide mal.
      const t = setTimeout(arrancar, 600)
      return () => clearTimeout(t)
    }
  }, [arrancar])

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
