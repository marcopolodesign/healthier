import { useEffect, useState } from 'react'
import {
  CaretLeft, CaretRight, CaretDown, GraduationCap, CheckCircle,
} from '@phosphor-icons/react'
import { CODIGO_DE_CIERRE } from '../../lib/simulacion'

/**
 * La franja de práctica y la guía paso a paso de la simulación de videollamada.
 *
 * ── Por qué va arriba y no flotando en una esquina ───────────────────────────
 *
 * La primera versión era una tarjeta flotante abajo a la izquierda. **Tapaba el
 * botón "Ingresar paciente"** — que está centrado en el área de video y es
 * justamente lo que el paso 3 te pide tocar. Lo encontró la prueba en browser,
 * no una lectura del código.
 *
 * Cualquier esquina tiene el mismo problema con algo: abajo a la derecha está la
 * cámara propia, la derecha entera es el panel clínico con sus formularios, y el
 * centro del video es donde aparecen todos los estados de espera. Y no alcanza
 * con elegir mejor la esquina: el profesional arrastra el divisor entre video y
 * panel, y en mobile la Historia Clínica sube como hoja desde abajo, así que la
 * geometría cambia debajo de los pies de la guía.
 *
 * Arriba, empujando el contenido en vez de flotar sobre él, no puede tapar nada
 * — pase lo que pase con el divisor o con la hoja.
 *
 * ── Por qué se avanza a mano ─────────────────────────────────────────────────
 *
 * Detectar "ya cargó los signos vitales" para avanzar solo ataría la guía a la
 * estructura interna del panel clínico, que es la parte que más cambia. El que
 * ya sabe saltea con los puntos; el que no, relee. Un paso no se puede quedar
 * trabado porque el detector se rompió.
 *
 * No guarda nada en la base, como el resto de la simulación. En `localStorage`
 * queda sólo si ya la completó, para no volver a desplegarla sola.
 */

const CLAVE_VISTA = 'healthier:guia-simulacion-vista'

const PASOS = [
  {
    titulo: 'Esto es una práctica',
    cuerpo: 'La paciente no existe y nada de lo que hagas acá se guarda: ni la historia clínica, ni las notas, ni la consulta. Podés equivocarte todas las veces que quieras.',
    detalle: 'Cerrá y volvé a entrar cuando quieras — arranca de cero.',
  },
  {
    titulo: 'Mirá con qué llega',
    cuerpo: 'Antes de entrar, la paciente completa un cuestionario. Lo tenés en el panel de la derecha, arriba de todo: motivo, síntomas y desde cuándo.',
    detalle: 'Acá: dolor de garganta y fiebre hace 3 días.',
  },
  {
    titulo: 'Dejala entrar',
    cuerpo: 'La paciente está en la sala de espera pero no puede entrar hasta que la habilites. Tocá "Ingresar paciente".',
    detalle: 'Es el paso que más dudas genera: hasta que no lo tocás, del otro lado el botón está gris.',
  },
  {
    titulo: 'Revisá los antecedentes',
    cuerpo: 'En la pestaña Historia Clínica está lo que le pasó antes. Miralo ahora, no después de recetar.',
    detalle: 'Ojo con la alergia cargada — choca con lo primero que uno recetaría para una angina.',
  },
  {
    titulo: 'Cargá la consulta',
    cuerpo: 'En Notas de consulta escribí lo que encontrás: síntomas, signos vitales y el diagnóstico. El diagnóstico se busca por nombre y queda con su código.',
    detalle: 'En la consulta real esto queda firmado con tu matrícula y no se puede borrar.',
  },
  {
    titulo: 'Recetá',
    cuerpo: 'Si tu especialidad receta, tenés la pestaña Recetario. Buscá el medicamento en el vademécum y emitila: vas a recibir el PDF de verdad.',
    detalle: 'En la práctica la receta sale contra el ambiente de pruebas — no tiene validez legal y no le llega a nadie.',
  },
  {
    titulo: 'Cerrá la consulta',
    cuerpo: `Al terminar, la paciente te dicta un código de 4 dígitos para confirmar que la atendiste. En la práctica es ${CODIGO_DE_CIERRE}.`,
    detalle: 'Probá poner uno equivocado primero, para ver qué pasa.',
  },
  {
    titulo: 'Listo',
    cuerpo: 'Eso es todo el recorrido. Cuando tengas una consulta real, la pantalla es exactamente ésta.',
    detalle: null,
  },
]

export default function GuiaSimulacion({ onSalir }) {
  const [paso, setPaso] = useState(0)
  const [abierta, setAbierta] = useState(true)

  // Desplegada la primera vez, plegada las siguientes: el que ya la hizo viene a
  // practicar, no a leerla otra vez.
  useEffect(() => {
    try {
      if (localStorage.getItem(CLAVE_VISTA)) setAbierta(false)
    } catch { /* modo privado o cookies bloqueadas: queda desplegada */ }
  }, [])

  const avanzar = () => {
    const siguiente = Math.min(paso + 1, PASOS.length - 1)
    setPaso(siguiente)
    if (siguiente === PASOS.length - 1) {
      try { localStorage.setItem(CLAVE_VISTA, '1') } catch { /* da igual */ }
    }
  }

  const actual = PASOS[paso]
  const ultimo = paso === PASOS.length - 1

  return (
    <div className="shrink-0 bg-brand text-white">
      {/* La franja siempre visible. No se puede cerrar: el panel es idéntico al
          real, y quien vuelve a la pestaña diez minutos después no tiene otra
          forma de saber que la paciente no existe. */}
      <button
        onClick={() => setAbierta(a => !a)}
        className="flex w-full items-center gap-3 px-4 py-1.5 text-left transition-colors hover:bg-black/10"
      >
        <GraduationCap weight="fill" className="h-4 w-4 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wide">Modo práctica</span>
        <span className="hidden text-xs text-white/70 sm:inline">· paciente de mentira, no se guarda nada</span>
        <span className="ml-auto flex items-center gap-2 text-xs font-medium">
          <span className="hidden sm:inline">Paso {paso + 1} de {PASOS.length} · {actual.titulo}</span>
          <span className="sm:hidden">{paso + 1}/{PASOS.length}</span>
          <CaretDown className={`h-3.5 w-3.5 transition-transform ${abierta ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {abierta && (
        <div className="border-t border-white/20 bg-white/10 px-4 py-3">
          <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{actual.titulo}</p>
              <p className="mt-0.5 text-sm text-white/85">{actual.cuerpo}</p>
              {actual.detalle && (
                <p className="mt-1.5 text-xs text-white/60">{actual.detalle}</p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setPaso(p => Math.max(p - 1, 0))}
                disabled={paso === 0}
                aria-label="Paso anterior"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/30 transition-colors hover:bg-white/15 disabled:opacity-30"
              >
                <CaretLeft className="h-4 w-4" />
              </button>
              {ultimo ? (
                <button
                  onClick={onSalir}
                  className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-white/90"
                >
                  <CheckCircle weight="fill" className="h-4 w-4" /> Terminar práctica
                </button>
              ) : (
                <button
                  onClick={avanzar}
                  className="flex items-center gap-1 rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-white/90"
                >
                  Siguiente <CaretRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Puntos y no una barra: son ocho pasos discretos y se puede volver a
              cualquiera tocándolo. */}
          <div className="mx-auto mt-3 flex max-w-4xl items-center gap-1.5">
            {PASOS.map((p, i) => (
              <button
                key={p.titulo}
                onClick={() => setPaso(i)}
                aria-label={`Paso ${i + 1}: ${p.titulo}`}
                className={`h-1 flex-1 rounded-full transition-colors ${i <= paso ? 'bg-white' : 'bg-white/25'}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
