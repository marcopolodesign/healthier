import { useState, useEffect, useMemo, useRef } from 'react'
import { MagnifyingGlass, CircleNotch, Check, X, Warning } from '@phosphor-icons/react'
import { rctaService } from '../services/rctaService'

/**
 * Selector de financiador (obra social / prepaga) del catálogo de Innovamed.
 *
 * Reemplaza el campo de texto libre. La API de RCTA no acepta el NOMBRE de la
 * obra social: necesita el `idFinanciador` de su catálogo (~900 entradas, que
 * cambia con el tiempo — por eso nunca se hardcodean ids).
 *
 * Modela **tres** estados, no dos, porque significan cosas distintas al emitir:
 *
 *   sin definir → todavía no se preguntó
 *   financiador → tiene cobertura; va `cobertura` en el payload
 *   particular  → explícitamente sin cobertura; se OMITE `cobertura`
 *
 * Confundir "no sabemos" con "es particular" haría emitir recetas particulares a
 * pacientes que sí tienen obra social.
 *
 * @param {object} props
 * @param {'financiador'|'particular'|null} props.coverageType
 * @param {number|null} props.financiadorId
 * @param {string} props.financiadorName
 * @param {string} props.affiliateNumber
 * @param {(v: {coverageType, financiadorId, financiadorName, affiliateNumber}) => void} props.onChange
 */
export default function FinanciadorPicker({
  coverageType, financiadorId, financiadorName, affiliateNumber, onChange,
}) {
  const [financiadores, setFinanciadores] = useState(null)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  // El catálogo se trae una sola vez y se filtra en memoria: son ~900 entradas,
  // pesan poco, y filtrar local evita una request por tecla.
  useEffect(() => {
    if (coverageType !== 'financiador' || financiadores) return
    let cancelled = false
    rctaService.listarFinanciadores()
      .then(f => { if (!cancelled) setFinanciadores(f) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [coverageType, financiadores])

  useEffect(() => {
    const onDocClick = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const filtrados = useMemo(() => {
    if (!financiadores) return []
    const q = query.trim().toLowerCase()
    if (!q) return financiadores.slice(0, 30)
    return financiadores.filter(f => f.nombreComercial.toLowerCase().includes(q)).slice(0, 30)
  }, [financiadores, query])

  const set = patch => onChange({
    coverageType, financiadorId, financiadorName, affiliateNumber, ...patch,
  })

  const Opcion = ({ value, label, desc }) => (
    <button
      type="button"
      onClick={() => set(value === 'particular'
        // Particular limpia financiador y afiliado: la constraint de la base lo
        // exige, y dejarlos sería un dato contradictorio.
        ? { coverageType: 'particular', financiadorId: null, financiadorName: '', affiliateNumber: '' }
        : { coverageType: value })}
      className={`flex-1 text-left px-3 py-2.5 rounded-xl border transition-colors ${
        coverageType === value
          ? 'border-brand bg-brand-muted text-text-primary'
          : 'border-border-default bg-bg-primary text-text-secondary hover:border-gray-300'
      }`}
    >
      <span className="block text-sm font-semibold">{label}</span>
      <span className="block text-[11px] text-text-tertiary mt-0.5">{desc}</span>
    </button>
  )

  return (
    <div className="space-y-3">
      <div>
        <label className="form-label text-xs">¿Tiene cobertura?</label>
        <div className="flex gap-2">
          <Opcion value="financiador" label="Sí, obra social" desc="Se receta con cobertura" />
          <Opcion value="particular"  label="Particular"      desc="Sin cobertura" />
        </div>
        {coverageType == null && (
          // No es obligatorio: Innovamed acepta recetas sin financiador — de
          // hecho una de las cuatro pruebas de certificación es particular.
          // Lo que sí importa es no confundir "no preguntamos" con "es
          // particular", porque un afiliado que reciba una receta particular
          // pierde la cobertura del medicamento.
          // Copy neutral: lo lee el profesional en la consulta y el paciente
          // en su onboarding — no asumir quién emite.
          <p className="text-[11px] text-text-tertiary mt-1.5">
            Sin definir — opcional. Sin obra social, las recetas salen sin cobertura, como particular.
          </p>
        )}
      </div>

      {coverageType === 'financiador' && (
        <>
          <div ref={boxRef}>
            <label className="form-label text-xs">Obra social / prepaga</label>

            {financiadorId ? (
              <div className="rounded-xl border border-brand/40 bg-brand-muted/30 px-3 py-2.5 flex items-center gap-2">
                <Check className="h-4 w-4 text-brand shrink-0" weight="bold" />
                <span className="flex-1 min-w-0 text-sm font-semibold text-text-primary truncate">
                  {financiadorName}
                </span>
                <button
                  type="button"
                  onClick={() => { set({ financiadorId: null, financiadorName: '' }); setQuery('') }}
                  className="text-text-tertiary hover:text-danger shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setOpen(true) }}
                  onFocus={() => setOpen(true)}
                  placeholder={financiadores ? 'Buscá: OSDE, Swiss Medical…' : 'Cargando catálogo…'}
                  disabled={!financiadores && !error}
                  className="form-input pl-9"
                  autoComplete="off"
                />
                {!financiadores && !error && (
                  <CircleNotch className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-brand" />
                )}

                {open && filtrados.length > 0 && (
                  <ul className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-bg-surface border border-border-default rounded-xl shadow-lg">
                    {filtrados.map(f => (
                      <li key={f.idfinanciador}>
                        <button
                          type="button"
                          onClick={() => {
                            set({ financiadorId: f.idfinanciador, financiadorName: f.nombreComercial })
                            setOpen(false)
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-brand-muted/40 border-b border-border-default last:border-b-0"
                        >
                          {f.nombreComercial}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {error && (
              <p className="text-[11px] text-danger mt-1 flex items-start gap-1">
                <Warning className="h-3 w-3 mt-0.5 shrink-0" weight="fill" />
                No pudimos cargar el catálogo de Innovamed. {error}
              </p>
            )}
          </div>

          <div>
            <label className="form-label text-xs">N° de afiliado</label>
            <input
              type="text"
              value={affiliateNumber}
              onChange={e => set({ affiliateNumber: e.target.value })}
              placeholder="Ej: 23200126801"
              className="form-input"
            />
            {financiadorId && !affiliateNumber.trim() && (
              // Innovamed rechaza (QBI25) toda receta que informe financiador
              // sin afiliado — avisarlo acá, antes de que el intento de emisión
              // falle. Se puede guardar la cobertura igual y completarlo después.
              <p className="text-[11px] text-danger mt-1 flex items-start gap-1">
                <Warning className="h-3 w-3 mt-0.5 shrink-0" weight="fill" />
                Requerido para emitir recetas: con obra social, Innovamed exige el número de afiliado.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
