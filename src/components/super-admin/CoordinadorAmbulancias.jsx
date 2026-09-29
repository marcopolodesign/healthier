import { useState, useEffect } from 'react'
import { Headset, MagnifyingGlass } from '@phosphor-icons/react'
import { coordinadorEmergenciasService } from '../../services/coordinadorEmergenciasService'
import { toast } from '../Toast'

const ROL = {
  patient: 'Paciente',
  professional: 'Profesional',
  admin: 'Admin',
  super_admin: 'Super admin',
}

/**
 * Quién coordina las ambulancias. Le llega un push por cada pedido nuevo y
 * asigna ambulancia y médico desde la app (migración 179). Puede ser
 * cualquier usuario: elegirlo no le cambia el rol.
 */
export default function CoordinadorAmbulancias() {
  const [actual, setActual] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState(null)
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [guardando, setGuardando] = useState(null)
  const [errorGuardar, setErrorGuardar] = useState(null)

  useEffect(() => {
    coordinadorEmergenciasService.getActual()
      .then(setActual)
      .catch(err => setErrorCarga(err.message))
      .finally(() => setCargando(false))
  }, [])

  useEffect(() => {
    if (texto.trim().length < 2) { setResultados([]); return }
    let vigente = true
    setBuscando(true)
    const t = setTimeout(() => {
      coordinadorEmergenciasService.buscarUsuarios(texto)
        .then(r => { if (vigente) setResultados(r) })
        .catch(err => { if (vigente) toast.error(err.message) })
        .finally(() => { if (vigente) setBuscando(false) })
    }, 250)
    return () => { vigente = false; clearTimeout(t) }
  }, [texto])

  const elegir = async (usuario) => {
    setGuardando(usuario.id)
    setErrorGuardar(null)
    try {
      const nuevo = await coordinadorEmergenciasService.definir(usuario.id)
      setActual(nuevo)
      setTexto('')
      toast.success(`${nuevo?.fullName || usuario.fullName} es el nuevo coordinador`)
    } catch (err) {
      setErrorGuardar(err.message)
    } finally {
      setGuardando(null)
    }
  }

  return (
    <div className="card">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-full bg-danger-muted text-danger flex items-center justify-center shrink-0">
          <Headset className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-semibold text-text-primary">Coordinador de ambulancias</h2>
          <p className="text-sm text-text-secondary">Le llega un aviso por cada pedido nuevo y asigna ambulancia y médico desde la app.</p>
        </div>
      </div>

      {cargando ? (
        <div className="h-14 bg-bg-surface rounded-lg animate-pulse" />
      ) : errorCarga ? (
        <p className="text-sm text-danger">No se pudo leer el coordinador: {errorCarga}</p>
      ) : actual ? (
        <div className="rounded-xl border border-border-default px-4 py-3">
          <p className="text-xs text-text-tertiary uppercase tracking-wide">Hoy coordina</p>
          <p className="text-text-primary font-medium">{actual.fullName || 'Sin nombre'}</p>
          <p className="text-sm text-text-secondary">{[actual.email, actual.provider].filter(Boolean).join(' · ')}</p>
        </div>
      ) : (
        <p className="text-sm text-text-secondary rounded-xl border border-dashed border-border-default px-4 py-3">
          Todavía no hay coordinador. Los pedidos nuevos no le avisan a nadie hasta que elijas uno.
        </p>
      )}

      {!errorCarga && (
        <div className="mt-4">
          <label className="form-label" htmlFor="buscar-coordinador">Elegir a otra persona</label>
          <div className="relative">
            <MagnifyingGlass className="h-4 w-4 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="buscar-coordinador"
              type="search"
              value={texto}
              onChange={e => setTexto(e.target.value)}
              placeholder="Buscar por nombre o mail"
              className="form-input pl-9"
            />
          </div>

          {errorGuardar && <p className="text-sm text-danger mt-2">{errorGuardar}</p>}

          {texto.trim().length >= 2 && (
            <ul className="mt-2 divide-y divide-border-default rounded-xl border border-border-default">
              {buscando && resultados.length === 0 ? (
                <li className="px-4 py-3 text-sm text-text-tertiary">Buscando…</li>
              ) : resultados.length === 0 ? (
                <li className="px-4 py-3 text-sm text-text-tertiary">Nadie coincide con “{texto.trim()}”</li>
              ) : resultados.map(u => {
                const esActual = u.id === actual?.profileId
                return (
                  <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-text-primary truncate">{u.fullName || 'Sin nombre'}</p>
                      <p className="text-xs text-text-tertiary truncate">{[u.email, ROL[u.role] ?? u.role].filter(Boolean).join(' · ')}</p>
                    </div>
                    {esActual ? (
                      <span className="text-xs text-text-tertiary shrink-0">Coordinador actual</span>
                    ) : (
                      <button
                        onClick={() => elegir(u)}
                        disabled={guardando != null}
                        className="btn-secondary text-sm px-3 py-1.5 shrink-0 disabled:opacity-50"
                      >
                        {guardando === u.id ? 'Guardando…' : 'Elegir como coordinador'}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
