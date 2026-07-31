import { useState, useEffect, useRef } from 'react'
import { MagnifyingGlass, CircleNotch, Check, X } from '@phosphor-icons/react'
import { rctaService } from '../../services/rctaService'

/**
 * Qué estudio es: buscador contra el catálogo de prácticas de Innovamed, con
 * texto libre permitido.
 *
 * La diferencia con `MedicationSearch` es deliberada y vale escribirla, porque a
 * simple vista son el mismo componente: **allá el código es obligatorio y acá
 * no**. En recetas, Innovamed rechaza el texto libre (`QBI105`), así que dejar
 * pasar un nombre escrito a mano garantiza una receta que no se va a poder
 * emitir. Acá no hay ninguna API del otro lado: el código sirve para tipificar y
 * poder agrupar después, pero un paciente con un estudio raro que no está en el
 * catálogo tiene que poder subirlo igual.
 *
 * Por eso: si el catálogo no responde o no encuentra nada, esto **degrada a
 * escribir a mano** en vez de bloquear.
 */
export default function EstudioSearch({ value, onChange, disabled = false }) {
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [abierto, setAbierto] = useState(false)
  const cajaRef = useRef(null)

  const texto = value?.nombre ?? ''
  const elegido = Boolean(value?.codigo)

  useEffect(() => {
    if (elegido) return
    const q = texto.trim()
    if (q.length < 3) { setResultados([]); return }

    let cancelado = false
    // Debounce: pegarle al catálogo de un tercero en cada tecla es abuso, y la
    // lista parpadeando mientras se escribe no deja elegir.
    const t = setTimeout(async () => {
      setBuscando(true)
      const r = await rctaService.buscarPracticas(q)
      if (!cancelado) { setResultados(r); setAbierto(r.length > 0); setBuscando(false) }
    }, 350)
    return () => { cancelado = true; clearTimeout(t) }
  }, [texto, elegido])

  useEffect(() => {
    const fuera = e => { if (cajaRef.current && !cajaRef.current.contains(e.target)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [])

  if (elegido) {
    return (
      <div className="rounded-xl border border-brand/40 bg-brand-muted/30 px-3 py-2.5 flex items-start gap-2">
        <Check className="h-4 w-4 text-brand mt-0.5 shrink-0" weight="bold" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{value.nombre}</p>
          <p className="text-[11px] text-text-tertiary">SNOMED {value.codigo}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange({ nombre: '', codigo: null })}
          aria-label="Cambiar el tipo de estudio"
          className="text-text-tertiary hover:text-danger shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative" ref={cajaRef}>
      <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
      <input
        type="text"
        value={texto}
        disabled={disabled}
        onChange={e => onChange({ nombre: e.target.value, codigo: null })}
        onFocus={() => resultados.length && setAbierto(true)}
        placeholder="Ej: Hemograma completo, Perfil tiroideo…"
        className="form-input pl-9 pr-9"
        autoComplete="off"
      />
      {buscando && <CircleNotch className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-brand" />}

      {abierto && resultados.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-bg-surface border border-border-default rounded-xl shadow-lg">
          {/* La forma real de la respuesta (verificada contra el sandbox, no
              supuesta): `practica` es el nombre, `nomenclador.snomed` el código.
              Se guarda el SNOMED y no el `id` de Innovamed porque es el estándar
              que ya usa el modelo clínico del proyecto y sirve fuera de RCTA. */}
          {resultados.map(p => (
            <li key={p.id ?? p.practica}>
              <button
                type="button"
                onClick={() => {
                  onChange({ nombre: p.practica, codigo: p.nomenclador?.snomed ?? null })
                  setAbierto(false)
                }}
                className="w-full text-left px-3 py-2 hover:bg-brand-muted/40 transition-colors border-b border-border-default last:border-b-0"
              >
                <p className="text-sm font-medium text-text-primary first-letter:uppercase">{p.practica}</p>
                {(p.categoria || p.tipo) && (
                  <p className="text-[11px] text-text-tertiary">
                    {[p.tipo, p.categoria].filter(Boolean).join(' · ')}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {texto.trim().length >= 3 && !buscando && resultados.length === 0 && (
        <p className="text-[11px] text-text-tertiary mt-1">
          No está en el catálogo — se guarda tal cual lo escribiste.
        </p>
      )}
    </div>
  )
}
