import { useState, useEffect, useCallback, useRef } from 'react'
import { Ambulance, Plus, Trash, UserPlus, X, MagnifyingGlass } from '@phosphor-icons/react'
import {
  dispatchService, ESTADOS_AMBULANCIA, TIPOS_AMBULANCIA, ROLES_TRIPULACION,
} from '../../services/dispatchService'
import { toast } from '../../components/Toast'
import Modal from '../../components/Modal'

function BuscadorPersonas({ ambulanceId, onAsignado }) {
  const [texto, setTexto] = useState('')
  const [rol, setRol] = useState(ROLES_TRIPULACION[0].id)
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [asignando, setAsignando] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!texto.trim()) { setResultados([]); return }
    debounceRef.current = setTimeout(() => {
      setBuscando(true)
      dispatchService.buscarPersonas(texto)
        .then(setResultados)
        .catch(() => toast.error('Error al buscar personas'))
        .finally(() => setBuscando(false))
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [texto])

  const asignar = async (persona) => {
    setAsignando(true)
    try {
      await dispatchService.asignarTripulante({ ambulanceId, profileId: persona.id, crewRole: rol })
      toast.success('Tripulante agregado')
      setTexto('')
      setResultados([])
      onAsignado()
    } catch (err) {
      toast.error(err?.message || 'Error al agregar tripulante')
    } finally {
      setAsignando(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <MagnifyingGlass className="h-3.5 w-3.5 text-text-tertiary absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            className="form-input pl-7 text-sm"
            placeholder="Buscar por nombre..."
            value={texto}
            onChange={e => setTexto(e.target.value)}
          />
        </div>
        <select className="form-select text-sm" value={rol} onChange={e => setRol(e.target.value)}>
          {ROLES_TRIPULACION.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>
      {buscando && <p className="text-xs text-text-secondary">Buscando...</p>}
      {resultados.length > 0 && (
        <div className="space-y-1 border border-border-default rounded-lg p-1 max-h-40 overflow-y-auto">
          {resultados.map(p => (
            <button
              key={p.id}
              disabled={asignando}
              onClick={() => asignar(p)}
              className="w-full flex items-center justify-between text-left px-2 py-1.5 rounded-md hover:bg-bg-surface text-sm"
            >
              <span className="text-text-primary">{p.fullName}</span>
              <UserPlus className="h-4 w-4 text-brand shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AmbulanciaCard({ ambulancia, isAdmin, onCambio }) {
  const [guardandoEstado, setGuardandoEstado] = useState(false)
  const [bajandoId, setBajandoId] = useState(null)
  const [dandoBaja, setDandoBaja] = useState(false)

  const cambiarEstado = async (status) => {
    setGuardandoEstado(true)
    try {
      await dispatchService.actualizarAmbulancia(ambulancia.id, { status })
      toast.success('Estado actualizado')
      onCambio()
    } catch (err) {
      toast.error(err?.message || 'Error al actualizar el estado')
    } finally {
      setGuardandoEstado(false)
    }
  }

  const sacarTripulante = async (crewId) => {
    if (!confirm('¿Sacar a esta persona del móvil?')) return
    setBajandoId(crewId)
    try {
      await dispatchService.bajarTripulante(crewId)
      toast.success('Tripulante dado de baja')
      onCambio()
    } catch (err) {
      toast.error(err?.message || 'Error al dar de baja al tripulante')
    } finally {
      setBajandoId(null)
    }
  }

  const darDeBaja = async () => {
    if (!confirm(`¿Dar de baja el móvil "${ambulancia.label}"? Deja de aparecer en la flota.`)) return
    setDandoBaja(true)
    try {
      await dispatchService.darDeBajaAmbulancia(ambulancia.id)
      toast.success('Móvil dado de baja')
      onCambio()
    } catch (err) {
      toast.error(err?.message || 'Error al dar de baja el móvil')
      setDandoBaja(false)
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-text-primary">{ambulancia.label}</p>
          <p className="text-xs text-text-secondary">
            {ambulancia.plate ? `${ambulancia.plate} · ` : ''}
            {TIPOS_AMBULANCIA.find(t => t.id === ambulancia.unitType)?.label || ambulancia.unitType}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={darDeBaja}
            disabled={dandoBaja}
            className="text-text-tertiary hover:text-red-600 transition-colors shrink-0"
            title="Dar de baja el móvil"
          >
            <Trash className="h-4 w-4" />
          </button>
        )}
      </div>

      <select
        className="form-select text-sm"
        value={ambulancia.status}
        disabled={guardandoEstado}
        onChange={e => cambiarEstado(e.target.value)}
      >
        {ESTADOS_AMBULANCIA.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
      </select>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-text-secondary">Tripulación</p>
        {(ambulancia.tripulacion || []).length === 0 ? (
          <p className="text-xs text-text-tertiary">Sin tripulación asignada</p>
        ) : ambulancia.tripulacion.map(t => (
          <div key={t.id} className="flex items-center justify-between text-sm">
            <span className="text-text-primary">{t.profile?.fullName} <span className="text-text-tertiary text-xs">· {t.crewRole}</span></span>
            <button
              onClick={() => sacarTripulante(t.id)}
              disabled={bajandoId === t.id}
              className="text-text-tertiary hover:text-red-600 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <BuscadorPersonas ambulanceId={ambulancia.id} onAsignado={onCambio} />
    </div>
  )
}

export default function DespachoAmbulancias({ profile }) {
  const [entidad, setEntidad] = useState(null)
  const [ambulancias, setAmbulancias] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [creando, setCreando] = useState(false)
  const [nuevo, setNuevo] = useState({ label: '', plate: '', unitType: TIPOS_AMBULANCIA[0].id })

  const isAdmin = profile?.role === 'emergency_admin' || profile?.role === 'super_admin'

  const cargar = useCallback(async (providerId) => {
    try {
      const data = await dispatchService.listarAmbulancias(providerId)
      setAmbulancias(data)
    } catch {
      toast.error('Error al cargar la flota')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    dispatchService.miEntidad().then(e => { setEntidad(e); return cargar(e?.id) })
  }, [cargar])

  const crear = async (e) => {
    e.preventDefault()
    if (!nuevo.label.trim()) { toast.error('El nombre del móvil es obligatorio'); return }
    setCreando(true)
    try {
      await dispatchService.crearAmbulancia({
        providerId: entidad.id,
        label: nuevo.label.trim(),
        plate: nuevo.plate.trim(),
        unitType: nuevo.unitType,
      })
      toast.success('Móvil creado')
      setModalAbierto(false)
      setNuevo({ label: '', plate: '', unitType: TIPOS_AMBULANCIA[0].id })
      cargar(entidad.id)
    } catch (err) {
      toast.error(err?.message || 'Error al crear el móvil')
    } finally {
      setCreando(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-8 w-48 bg-bg-surface rounded-lg animate-pulse" />
        <div className="grid md:grid-cols-2 gap-4">
          {[1, 2].map(i => <div key={i} className="h-56 bg-bg-surface rounded-lg animate-pulse" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Ambulance className="h-6 w-6 text-brand" /> Ambulancias
          </h1>
          <p className="text-text-secondary mt-1">{ambulancias.length} móvil{ambulancias.length !== 1 ? 'es' : ''}</p>
        </div>
        {isAdmin && (
          <button className="btn-primary flex items-center gap-1.5" onClick={() => setModalAbierto(true)}>
            <Plus className="h-4 w-4" /> Nuevo móvil
          </button>
        )}
      </div>

      {ambulancias.length === 0 ? (
        <div className="card text-center py-16">
          <Ambulance className="h-12 w-12 text-text-muted mx-auto mb-3" />
          <p className="text-text-secondary">No hay móviles todavía</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {ambulancias.map(a => (
            <AmbulanciaCard key={a.id} ambulancia={a} isAdmin={isAdmin} onCambio={() => cargar(entidad.id)} />
          ))}
        </div>
      )}

      <Modal open={modalAbierto} onClose={() => setModalAbierto(false)} title="Nuevo móvil">
        <form onSubmit={crear} className="space-y-4">
          <div>
            <label className="form-label">Nombre *</label>
            <input
              className="form-input"
              placeholder="Móvil 12"
              value={nuevo.label}
              onChange={e => setNuevo(f => ({ ...f, label: e.target.value }))}
            />
          </div>
          <div>
            <label className="form-label">Patente</label>
            <input
              className="form-input"
              value={nuevo.plate}
              onChange={e => setNuevo(f => ({ ...f, plate: e.target.value }))}
            />
          </div>
          <div>
            <label className="form-label">Tipo</label>
            <select
              className="form-select"
              value={nuevo.unitType}
              onChange={e => setNuevo(f => ({ ...f, unitType: e.target.value }))}
            >
              {TIPOS_AMBULANCIA.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <button className="btn-primary w-full" disabled={creando}>{creando ? 'Creando...' : 'Crear móvil'}</button>
        </form>
      </Modal>
    </div>
  )
}
