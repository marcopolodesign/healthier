import { GraduationCap, Play } from '@phosphor-icons/react'
import { useTourGuiado } from '../../hooks/useTourGuiado'
import { CODIGO_DE_CIERRE } from '../../lib/simulacion'

/**
 * La franja "modo práctica" y el tour guiado de la simulación de videollamada.
 *
 * El motor del tour —driver.js, el overlay, el filtrado por `aplica()`, el
 * arranque-la-primera-vez— vive en `useTourGuiado`, compartido con los tours
 * del dashboard del paciente y del profesional. Acá quedan sólo los pasos y la
 * franja, que es propia de esta pantalla.
 *
 * ── Los pasos dependen de la vertical ───────────────────────────────────────
 *
 * **Sólo recetan las especialidades habilitadas** (`puede_recetar`, migración
 * 116: hoy clínica y pediatría). Al psicólogo no hay que explicarle cómo
 * recetar: la pestaña no existe para él, y dejar el paso hacía que el globo se
 * centrara y le enseñara algo que no puede hacer nunca. Lo mismo al revés con
 * NutriPlan, que es de nutrición y de nadie más.
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
  const { arrancar } = useTourGuiado({
    clave: CLAVE_VISTA,
    pasos: PASOS,
    ctx: { especialidad, receta: puedeRecetar },
    listo,
  })

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
