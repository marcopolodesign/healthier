import { useState, useEffect, useRef } from 'react'
import { MapPin, CircleNotch } from '@phosphor-icons/react';
import { searchAddresses, geocodeAddress, armarDireccion, direccionTieneNumero, validarDireccionConsultorio } from '../../lib/geo'

export default function AddressAutocomplete({ value, onChange, label = 'Dirección', required = false, placeholder = 'Ej: Av. Santa Fe 1900, Buenos Aires', className = '', exigirNumero = false, error = null }) {
  const [query, setQuery] = useState(value?.address || '')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounce = useRef(null)
  const containerRef = useRef(null)
  const abortRef = useRef(null)
  // Con `exigirNumero` (consultorio del profesional): una sugerencia que es sólo
  // la calle queda acá hasta que se le pone la altura.
  const [pendiente, setPendiente] = useState(null)
  const [numero, setNumero] = useState('')
  const [ubicando, setUbicando] = useState(false)
  const [tocado, setTocado] = useState(false)

  useEffect(() => {
    if (value?.address && query !== value.address) setQuery(value.address)
  }, [value?.address])

  useEffect(() => {
    const handleClick = e => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      clearTimeout(debounce.current)
      abortRef.current?.abort()
    }
  }, [])

  const handleInput = e => {
    const q = e.target.value
    setQuery(q)
    setPendiente(null)
    onChange({ address: q, latitude: null, longitude: null })
    clearTimeout(debounce.current)
    if (q.length < 3) { setResults([]); setOpen(false); return }
    debounce.current = setTimeout(async () => {
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      setLoading(true)
      try {
        const res = await searchAddresses(q, abortRef.current.signal)
        setResults(res)
        setOpen(res.length > 0)
      } catch (err) {
        if (err.name !== 'AbortError') setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
  }

  const select = item => {
    setOpen(false)
    setResults([])
    if (!exigirNumero) {
      setQuery(item.displayName)
      onChange({ address: item.displayName, latitude: item.lat, longitude: item.lng })
      return
    }
    if (item.numero && item.calle) {
      const address = armarDireccion(item)
      setPendiente(null)
      setQuery(address)
      onChange({ address, latitude: item.lat, longitude: item.lng })
      return
    }
    // La sugerencia es sólo la calle: se pide el número. Mientras tanto el
    // formulario recibe la calle sin coordenadas, y no deja guardar.
    const calle = item.calle || item.displayName.split(',')[0]
    setPendiente({ ...item, calle })
    setNumero('')
    setQuery(calle)
    onChange({ address: calle, latitude: null, longitude: null })
  }

  const confirmarNumero = async () => {
    const n = numero.trim()
    if (!pendiente || !/^\d{1,5}\s?[A-Za-z]?$/.test(n)) return
    const address = armarDireccion({ ...pendiente, numero: n })
    setUbicando(true)
    // Re-geocodificar a esa altura: las coordenadas de la sugerencia son las de
    // la calle entera, no las del número.
    const geo = await geocodeAddress(address)
    setUbicando(false)
    setPendiente(null)
    setQuery(address)
    onChange({ address, latitude: geo?.lat ?? null, longitude: geo?.lng ?? null })
  }

  const faltaNumero = exigirNumero && !pendiente && Boolean(query.trim()) && !direccionTieneNumero(query)
  const mensajeError = error || (pendiente ? 'Agregá el número de la calle' : (tocado && faltaNumero ? validarDireccionConsultorio(query) : null))

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label className="form-label">
          {label} {required && <span className="text-danger">*</span>}
        </label>
      )}
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={handleInput}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTocado(true)}
          placeholder={placeholder}
          className="form-input pl-9"
          autoComplete="off"
        />
        {loading && <CircleNotch className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary animate-spin" />}
      </div>
      {pendiente && (
        <div className="mt-2 flex items-center gap-2" data-testid="direccion-pedir-numero">
          <input
            type="text"
            inputMode="numeric"
            value={numero}
            onChange={e => setNumero(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmarNumero() } }}
            placeholder="Número"
            aria-label="Número de la calle"
            data-testid="direccion-numero-input"
            className="form-input w-32"
            autoFocus
          />
          <button
            type="button"
            onClick={confirmarNumero}
            disabled={ubicando || !/^\d{1,5}\s?[A-Za-z]?$/.test(numero.trim())}
            data-testid="direccion-numero-confirmar"
            className="btn-secondary px-4 py-2 text-sm"
          >
            {ubicando ? 'Ubicando…' : 'Confirmar'}
          </button>
        </div>
      )}
      {mensajeError && (
        <p className="text-sm text-danger mt-1.5" role="alert" data-testid="direccion-falta-numero">{mensajeError}</p>
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-border-default max-h-48 overflow-y-auto">
          {results.map((item, i) => (
            <li
              key={i}
              onMouseDown={() => select(item)}
              className="flex items-start gap-2 px-3 py-2.5 cursor-pointer hover:bg-bg-surface transition-colors text-sm"
            >
              <MapPin className="h-4 w-4 text-text-tertiary shrink-0 mt-0.5" />
              <span className="text-text-primary line-clamp-2">{item.displayName}</span>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && results.length === 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-border-default px-3 py-2.5 text-sm text-text-secondary">
          Sin resultados
        </div>
      )}
    </div>
  )
}
