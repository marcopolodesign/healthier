import { useState, useEffect, useRef } from 'react'
import { MagnifyingGlass, CircleNotch, Check, Warning, X } from '@phosphor-icons/react'
import { rctaService } from '../../services/rctaService'
import { capitalizarNombreCatalogo } from '../../lib/format'

/**
 * Buscador de medicamentos contra el catálogo de Innovamed.
 *
 * Reemplaza el campo de texto libre que había antes. La API de RCTA rechaza el
 * nombre escrito a mano con `QBI105 — CODIGO INFORMADO INEXISTENTE`: hay que
 * mandar el `regNo` de SU catálogo. Elegir de acá es lo que hace que la receta
 * se pueda emitir.
 *
 * **Elegir del catálogo es obligatorio** desde el 2026-07-29 (decisión de Mateo).
 * Antes se aceptaba texto libre "para la historia clínica" y el resultado fue que
 * la mayoría de las medicaciones cargadas quedaron sin `reg_no`, o sea imposibles
 * de recetar. El input de acá busca; guardar sin selección lo bloquea el formulario.
 *
 * @param {object} props
 * @param {string} props.value            texto actual
 * @param {(v: string) => void} props.onTextChange   escribió a mano
 * @param {(m: object|null) => void} props.onSelect  eligió del catálogo (null = lo descartó)
 * @param {object|null} props.selected    medicamento elegido, si hay
 * @param {{idFinanciador?: number, afiliado?: string}} [props.cobertura]
 */
export default function MedicationSearch({ value, onTextChange, onSelect, selected, cobertura }) {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(null)
  const boxRef = useRef(null)

  // Debounce: cada tecla contra la API de un tercero es abuso y además hace
  // parpadear la lista mientras se escribe.
  useEffect(() => {
    if (selected) return
    const q = (value ?? '').trim()
    if (q.length < 3) { setResults([]); setError(null); return }

    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true); setError(null)
      try {
        const meds = await rctaService.buscarMedicamentos(q, {
          idFinanciador: cobertura?.idFinanciador ?? null,
          afiliado: cobertura?.afiliado ?? null,
        })
        if (!cancelled) { setResults(meds); setOpen(true) }
      } catch (e) {
        if (!cancelled) { setError(e.message); setResults([]) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 350)
    return () => { cancelled = true; clearTimeout(t) }
  }, [value, selected, cobertura?.idFinanciador, cobertura?.afiliado])

  useEffect(() => {
    const onDocClick = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // ── Ya eligió: se muestra lo elegido, no un input ──────────────────────────
  if (selected) {
    return (
      <div className="rounded-xl border border-brand/40 bg-brand-muted/30 px-3 py-2.5 flex items-start gap-2">
        <Check className="h-4 w-4 text-brand mt-0.5 shrink-0" weight="bold" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">
            {capitalizarNombreCatalogo(selected.nombreProducto)} <span className="font-normal text-text-secondary">{selected.presentacion}</span>
          </p>
          <p className="text-[11px] text-text-tertiary">
            {capitalizarNombreCatalogo(selected.nombreDroga)} · cód. {selected.regNo}
            {selected.tieneCobertura === false && ' · sin cobertura'}
          </p>
          {(selected.psicofarmaco || selected.estupefaciente || selected.requiereDuplicado) && (
            <p className="text-[11px] text-amber-700 font-semibold mt-0.5">
              {[selected.psicofarmaco && 'Psicofármaco',
                selected.estupefaciente && 'Estupefaciente',
                selected.requiereDuplicado && 'Requiere duplicado'].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <button type="button" onClick={() => onSelect(null)} className="text-text-tertiary hover:text-danger shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  const textoLibre = (value ?? '').trim().length >= 3 && !loading && results.length === 0 && !error

  return (
    <div className="relative" ref={boxRef}>
      <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={e => onTextChange(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder="Buscá en el vademécum: amoxicilina, ibuprofeno…"
        className="form-input pl-9 pr-9"
        autoComplete="off"
      />
      {loading && <CircleNotch className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-brand" />}

      {open && results.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-y-auto bg-bg-surface border border-border-default rounded-xl shadow-lg">
          {results.map(m => (
            <li key={m.regNo}>
              <button
                type="button"
                onClick={() => { onSelect(m); setOpen(false) }}
                className="w-full text-left px-3 py-2 hover:bg-brand-muted/40 transition-colors border-b border-border-default last:border-b-0"
              >
                <p className="text-sm font-medium text-text-primary">
                  {capitalizarNombreCatalogo(m.nombreProducto)} <span className="text-text-secondary font-normal">{m.presentacion}</span>
                </p>
                <p className="text-[11px] text-text-tertiary">
                  {capitalizarNombreCatalogo(m.nombreDroga)}
                  {m.tieneCobertura === false && ' · sin cobertura'}
                  {m.psicofarmaco && ' · psicofármaco'}
                  {m.estupefaciente && ' · estupefaciente'}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-[11px] text-danger mt-1 flex items-start gap-1">
          <Warning className="h-3 w-3 mt-0.5 shrink-0" weight="fill" /> {error}
        </p>
      )}

      {textoLibre && (
        <p className="text-[11px] text-amber-700 mt-1 flex items-start gap-1">
          <Warning className="h-3 w-3 mt-0.5 shrink-0" weight="fill" />
          Sin resultados en el vademécum. Probá con el nombre comercial o
          la droga — <strong>hay que elegirlo de la lista</strong> para poder recetarlo.
        </p>
      )}
    </div>
  )
}
