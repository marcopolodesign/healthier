import { useEffect, useState } from 'react'
import { CircleNotch } from '@phosphor-icons/react'
import { referralService } from '../../services/referralService'
import { toast } from '../Toast'
import { track } from '../../utils/analytics'

const MOTIVOS = {
  codigo_invalido: 'No encontramos ese código.',
  ya_tiene_referente: 'Tu cuenta ya tiene un código cargado.',
  ya_consulto: 'Ese beneficio es para antes de tu primera consulta.',
  propio: 'Ese código es tuyo.',
  circular: 'Ese código no se puede usar en tu cuenta.',
  no_aplica: 'Ese código no se puede usar en tu cuenta.',
}

/**
 * Perfil del paciente: cargar el código de un socio comercial (ej. LIFT) si se
 * registró sin el link, o ver el beneficio que ya tiene. El servidor decide si
 * vale (`canjear_codigo`, migración 252); acá sólo se muestra.
 */
export default function CodigoBeneficio() {
  const [beneficio, setBeneficio] = useState(undefined) // undefined = cargando
  const [abierto, setAbierto] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => { referralService.miBeneficio().then(setBeneficio) }, [])

  if (beneficio === undefined) return null

  if (beneficio) {
    const pct = Math.round(Number(beneficio.porcentaje) * 100)
    return (
      <div className="w-full bg-bg-secondary rounded-2xl p-5" data-testid="beneficio-socio">
        <p className="font-semibold text-text-primary text-[15px]">Beneficio {beneficio.socioNombre}</p>
        <p className="text-xs text-text-secondary mt-0.5">
          {beneficio.disponible ? `${pct}% off en tu primera consulta` : 'Ya lo usaste en tu primera consulta'}
        </p>
      </div>
    )
  }

  const cargar = async (e) => {
    e.preventDefault()
    const c = codigo.trim().toLowerCase()
    if (!c || enviando) return
    setEnviando(true)
    const r = await referralService.canjear(c, 'codigo')
    setEnviando(false)
    track('codigo_beneficio_cargado', { ok: Boolean(r?.ok), motivo: r?.motivo ?? null, flow: 'paciente' })
    if (r?.ok) {
      toast.success(r.tipo === 'socio' ? `Listo: tenés el beneficio ${r.referenteNombre}.` : 'Listo, código cargado.')
      setBeneficio(await referralService.miBeneficio())
      setAbierto(false)
    } else {
      toast.error(MOTIVOS[r?.motivo] ?? 'No pudimos cargar el código. Probá de nuevo.')
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="w-full bg-bg-secondary rounded-2xl p-5 text-left hover:bg-brand-muted transition-colors"
        data-testid="cargar-codigo"
      >
        <p className="font-semibold text-text-primary text-[15px]">¿Tenés un código de beneficio?</p>
        <p className="text-xs text-text-secondary mt-0.5">Si sos socio de un gimnasio o empresa aliada</p>
      </button>
    )
  }

  return (
    <form onSubmit={cargar} className="w-full bg-bg-secondary rounded-2xl p-5 space-y-3">
      <label className="form-label" htmlFor="codigo-beneficio">Código</label>
      <div className="flex gap-2">
        <input
          id="codigo-beneficio"
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          value={codigo}
          onChange={e => setCodigo(e.target.value.toUpperCase())}
          placeholder="Código"
          className="form-input uppercase tracking-widest flex-1"
        />
        <button type="submit" disabled={!codigo.trim() || enviando} className="btn-primary shrink-0">
          {enviando ? <CircleNotch className="w-4 h-4 animate-spin" /> : 'Cargar'}
        </button>
      </div>
    </form>
  )
}
