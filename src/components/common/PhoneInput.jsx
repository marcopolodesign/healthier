import { useState, useEffect, useRef } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { COUNTRIES, splitPhone, joinPhone } from '../../data/countries'

/**
 * Campo de teléfono con selector de código de país.
 *
 * Espejo del que ya tiene la app (`register.tsx` y `complete-profile.tsx`). El
 * número se guarda SIEMPRE con el código adelante — `+54 11 1234 5678` — porque
 * es el único formato del que se puede armar un link de WhatsApp y el que
 * Customer.io necesita para que el envío no falle o le llegue a otra persona.
 * Antes el campo era texto libre y cada uno escribía lo que quería.
 *
 * Emite el valor completo ya unido, así el que lo usa sigue manejando un solo
 * string y no se entera del selector.
 *
 * @param {object} props
 * @param {string} props.value — teléfono completo, con código de país
 * @param {(v: string) => void} props.onChange
 * @param {boolean} [props.required]
 * @param {boolean} [props.disabled]
 * @param {string} [props.placeholder]
 * @param {string} [props.inputClassName] — para el input del número, si hace falta otro estilo
 */
export default function PhoneInput({
  value,
  onChange,
  required = false,
  disabled = false,
  placeholder = '11 1234 5678',
  inputClassName = 'form-input',
}) {
  const inicial = splitPhone(value)
  const [country, setCountry] = useState(inicial.country)
  const [number, setNumber] = useState(inicial.number)
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)
  // Lo último que emitimos nosotros. Sirve para distinguir "el padre me cambió el
  // valor" de "el valor cambió porque yo lo emití" — sin esto, el perfil que se
  // carga async pisaría lo que la persona está tipeando, y viceversa.
  const ultimoEmitido = useRef(value ?? '')

  useEffect(() => {
    if ((value ?? '') === ultimoEmitido.current) return
    const next = splitPhone(value)
    setCountry(next.country)
    setNumber(next.number)
    ultimoEmitido.current = value ?? ''
  }, [value])

  useEffect(() => {
    const onDocClick = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const emitir = (c, n) => {
    const out = joinPhone(c, n)
    ultimoEmitido.current = out
    onChange(out)
  }

  const onNumberChange = e => {
    // Se deja sólo lo que puede formar parte de un número. Si pega el código de
    // país de nuevo, el `+` no entra y no queda un `+54 +54 11...`.
    const limpio = e.target.value.replace(/[^\d\s()-]/g, '')
    setNumber(limpio)
    emitir(country, limpio)
  }

  const elegirPais = c => {
    setCountry(c)
    setOpen(false)
    emitir(c, number)
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(o => !o)}
          aria-label={`Código de país: ${country.name} ${country.code}`}
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-border-default bg-bg-secondary px-3 py-2.5 text-[16px] text-text-primary transition-colors hover:border-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">{country.flag}</span>
          <span className="font-medium">{country.code}</span>
          <CaretDown className="h-3 w-3 text-text-tertiary" />
        </button>

        <input
          type="tel"
          required={required}
          disabled={disabled}
          value={number}
          onChange={onNumberChange}
          placeholder={placeholder}
          autoComplete="tel-national"
          className={inputClassName}
        />
      </div>

      {open && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-2xl border border-border-default bg-bg-secondary py-1 shadow-lg"
        >
          {COUNTRIES.map(c => (
            <li key={c.code + c.name}>
              <button
                type="button"
                role="option"
                aria-selected={c.code === country.code && c.name === country.name}
                onClick={() => elegirPais(c)}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[15px] text-text-primary transition-colors hover:bg-bg-surface-hover"
              >
                <span aria-hidden="true">{c.flag}</span>
                <span className="flex-1">{c.name}</span>
                <span className="text-text-tertiary">{c.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
