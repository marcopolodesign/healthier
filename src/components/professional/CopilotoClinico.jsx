import { Sparkle, Warning, CheckCircle, Info } from '@phosphor-icons/react'
import { CLINICAL_GUIDE_KB, DISCLAIMER } from '../../lib/clinicalGuideKB'

/**
 * Copiloto clínico — columna derecha (30%) de "Consulta Estructurada"
 * (`ConsultaEstructurada.jsx`), dentro de la planilla de la videollamada.
 *
 * Reemplaza a `GuiaClinicaConsulta` (Mateo, 2026-08-24): esa versión escribía
 * una `clinical_entries` por cada tap — "miles de entradas por consulta".
 * Acá NO se escribe nada: cada click togglea el ítem contra el borrador
 * (`hcDraft`, ver `src/lib/consultaDraft.js`) que recién se asienta como UNA
 * entrada al guardar o al cerrar la consulta.
 *
 * Contenido ESTÁTICO por motivo: nada se reordena, esconde ni cambia según
 * lo que se va marcando — sólo el estado visual (seleccionado/no) cambia.
 * Mateo se quejó explícitamente de que la guía vieja "va cambiando a medida
 * que uno hace el diagnóstico".
 *
 * Orden fijo: banderas rojas → diferenciales → preguntas dirigidas. El
 * examen y los estudios sugeridos del KB (`guia.ex` / `guia.st`) NO se
 * muestran acá — el examen físico ahora es la sección fija "07" de la
 * consulta estructurada, y pedir estudios es el flujo propio de
 * Recetario > "Recetar estudios".
 */
export default function CopilotoClinico({ motivo, motivoLibre, draft, onToggleBandera, onTogglePregunta, onToggleDiferencial }) {
  const guia = motivo ? CLINICAL_GUIDE_KB[motivo] : null

  const banderaSeleccionada = texto => draft.sintomas.some(s => s.origen === 'bandera' && s.texto === texto)
  const preguntaSeleccionada = texto => draft.sintomas.some(s => s.origen === 'pregunta' && s.texto === texto)
  const diferencialSeleccionado = nombre => draft.diferenciales.some(d => d.nombre === nombre)

  return (
    <div className="rounded-xl border border-border-default bg-bg-surface p-3 space-y-3">
      <div className="flex items-center gap-1.5">
        <Sparkle className="h-4 w-4 text-brand" weight="fill" />
        <h4 className="text-[11px] font-bold text-text-tertiary uppercase tracking-widest">Copiloto clínico</h4>
      </div>

      {!motivo && !motivoLibre && (
        <p className="text-xs text-text-tertiary leading-relaxed">
          Elegí un motivo de consulta en "02. Motivo" para ver la guía clínica.
        </p>
      )}

      {((motivoLibre && !motivo) || (motivo && !guia)) && (
        <p className="text-xs text-text-tertiary leading-relaxed">
          No hay guía clínica para ese motivo todavía.
        </p>
      )}

      {guia && (
        <>
          <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 p-2">
            <Info className="h-3.5 w-3.5 text-amber-700 mt-0.5 shrink-0" />
            <p className="text-[10px] text-amber-800 leading-relaxed">{DISCLAIMER}</p>
          </div>

          {/* 1 · Banderas rojas — lo que no se puede pasar por alto */}
          <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 space-y-1.5">
            <p className="text-[10px] font-bold text-red-700 uppercase tracking-wide flex items-center gap-1">
              <Warning className="h-3 w-3" weight="fill" /> Banderas rojas
            </p>
            <ul className="space-y-1">
              {guia.rf.map(texto => {
                const sel = banderaSeleccionada(texto)
                return (
                  <li key={texto}>
                    <button
                      type="button"
                      onClick={() => onToggleBandera(texto)}
                      className={`w-full flex items-start gap-1.5 text-left text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                        sel
                          ? 'border-red-400 bg-red-100 text-red-800 font-medium'
                          : 'border-border-default bg-white text-text-primary hover:border-red-300 hover:bg-red-50'
                      }`}
                    >
                      <Warning
                        className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${sel ? 'text-red-600' : 'text-text-tertiary/40'}`}
                        weight={sel ? 'fill' : 'regular'}
                      />
                      <span className="flex-1">{texto}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* 2 · Diferenciales — toggle suma/saca un chip en "08. Diagnóstico" */}
          <div className="rounded-lg border border-border-default bg-white p-2.5 space-y-1.5">
            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide">Diagnósticos diferenciales</p>
            <div className="flex flex-wrap gap-1">
              {guia.dx.map(([nombre, code, urgente]) => {
                const sel = diferencialSeleccionado(nombre)
                return (
                  <button
                    type="button"
                    key={code}
                    onClick={() => onToggleDiferencial(nombre, code)}
                    className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                      sel
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                        : urgente
                        ? 'bg-red-50 text-red-700 border-red-300 font-semibold hover:bg-red-100'
                        : 'bg-white text-text-secondary border-border-default hover:border-brand hover:text-brand'
                    }`}
                  >
                    {sel && <CheckCircle className="h-3 w-3" weight="fill" />}
                    {nombre} · {code}{urgente && !sel ? ' · urgente' : ''}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 3 · Preguntas dirigidas — toggle suma/saca un ítem en "05. Síntomas" */}
          <div className="rounded-lg border border-border-default bg-white p-2.5 space-y-1.5">
            <p className="text-[10px] font-bold text-text-tertiary uppercase tracking-wide">Preguntas dirigidas</p>
            <ul className="space-y-1">
              {guia.q.map(texto => {
                const sel = preguntaSeleccionada(texto)
                return (
                  <li key={texto}>
                    <button
                      type="button"
                      onClick={() => onTogglePregunta(texto)}
                      className={`w-full flex items-start gap-1.5 text-left text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                        sel
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-border-default text-text-primary hover:border-brand hover:bg-brand-muted/20'
                      }`}
                    >
                      <CheckCircle
                        className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${sel ? 'text-emerald-600' : 'text-text-tertiary/40'}`}
                        weight={sel ? 'fill' : 'regular'}
                      />
                      <span className="flex-1">{texto}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
