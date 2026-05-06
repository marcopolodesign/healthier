import { useState, useEffect, useRef } from 'react'
import { MapPin, Loader2 } from 'lucide-react'
import { searchAddresses } from '../../lib/geo'

export default function AddressAutocomplete({ value, onChange, label = 'Dirección', placeholder = 'Ej: Av. Santa Fe 1900, Buenos Aires', className = '' }) {
  const [query, setQuery] = useState(value?.address || '')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounce = useRef(null)
  const containerRef = useRef(null)
  const abortRef = useRef(null)

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
    setQuery(item.displayName)
    setOpen(false)
    setResults([])
    onChange({ address: item.displayName, latitude: item.lat, longitude: item.lng })
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && <label className="form-label">{label}</label>}
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={handleInput}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="form-input pl-9"
          autoComplete="off"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary animate-spin" />}
      </div>
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
