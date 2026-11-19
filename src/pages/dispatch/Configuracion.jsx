import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Gear, Lock, LinkSimple, UserCircle } from '@phosphor-icons/react'
import MercadoPagoMark from '../../components/icons/MercadoPagoMark'
import { dispatchService } from '../../services/dispatchService'
import { toast } from '../../components/Toast'
import { useConectarMp } from '../../hooks/useConectarMp'
import { mensajeErrorMp } from '../../lib/mpErrores'

// Resultado del chequeo con SISA del operador del día (migración 241). Nunca frena nada.
function textoSisa(o) {
  switch (o.sisaEstado) {
    case 'habilitado': return { tono: 'ok', texto: `Figura en SISA${o.sisaProfesion ? ` · ${o.sisaProfesion}` : ''}${o.sisaMatricula ? ` · mat. ${o.sisaMatricula}` : ''}` }
    case 'suspendido': return { tono: 'aviso', texto: 'Figura en SISA, pero sin matrícula habilitada' }
    case 'no_encontrado': return { tono: 'aviso', texto: 'No figura en SISA' }
    case 'sin_respuesta': return { tono: 'aviso', texto: 'SISA no respondió' }
    default: return { tono: 'neutro', texto: 'Chequeando con SISA…' }
  }
}

function FilaOperador({ o }) {
  const [foto, setFoto] = useState(null)
  useEffect(() => {
    let vivo = true
    dispatchService.fotoDeOperador(o.fotoPath).then(u => { if (vivo) setFoto(u) }).catch(() => {})
    return () => { vivo = false }
  }, [o.fotoPath])
  const sisa = textoSisa(o)
  return (
    <div className="flex items-center gap-3 text-sm">
      {foto
        ? <img src={foto} alt={`Selfie de ${o.nombre}`} className="h-12 w-12 rounded-full object-cover shrink-0" />
        : <UserCircle className="h-12 w-12 text-text-muted shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="text-text-primary font-medium truncate">{o.nombre}</p>
        <p className="text-text-secondary text-xs">DNI {o.dni} · {o.dia} · {o.profile?.email}</p>
        <p className={`text-xs ${sisa.tono === 'ok' ? 'text-emerald-700' : sisa.tono === 'aviso' ? 'text-amber-700' : 'text-text-tertiary'}`}>{sisa.texto}</p>
      </div>
    </div>
  )
}

export default function DespachoConfiguracion({ profile }) {
  const [entidad, setEntidad] = useState(null)
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', legalName: '', phone: '', address: '', dispatchPhone: '', color: '#DC2626' })

  const isAdmin = profile?.role === 'emergency_admin' || profile?.role === 'super_admin'
  const [mp, setMp] = useState(null)
  const [operadores, setOperadores] = useState([])
  const [profesionales, setProfesionales] = useState([])
  const [ingresos, setIngresos] = useState([])
  const [busca, setBusca] = useState('')
  const [candidatos, setCandidatos] = useState([])
  const [desconectando, setDesconectando] = useState(false)
  const { conectar: conectarMp, conectando: conectandoMp } = useConectarMp(dispatchService.getMpConnectUrl)
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    const connected = searchParams.get('mp_connected')
    const mpError = searchParams.get('mp_error')
    if (!connected && !mpError) return
    if (connected === '1') toast.success('Mercado Pago conectado')
    if (mpError) toast.error(mensajeErrorMp(mpError))
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    dispatchService.estadoMp().then(setMp).catch(() => setMp({ conectado: false }))
    dispatchService.operadoresDelDia().then(setOperadores).catch(() => {})
  }, [])

  const buscarProfesional = async (texto) => {
    setBusca(texto)
    if (texto.trim().length < 2) return setCandidatos([])
    try {
      const r = await dispatchService.buscarPersonas(texto)
      const yaEstan = new Set(profesionales.map(p => p.professionalId))
      setCandidatos(r.filter(p => p.role === 'professional' && !yaEstan.has(p.id)))
    } catch { setCandidatos([]) }
  }
  const agregarProfesional = async (p) => {
    try {
      await dispatchService.agregarProfesionalDeEntidad(entidad.id, p.id)
      setProfesionales(await dispatchService.listarProfesionalesDeEntidad(entidad.id))
      setBusca(''); setCandidatos([])
      toast.success(`${p.fullName} agregado/a a la lista`)
    } catch (err) { toast.error(err?.message || 'No pudimos agregarlo') }
  }
  const cargarDni = async (p) => {
    const dni = window.prompt(`DNI de ${p.profile?.fullName || 'este profesional'} (7 u 8 números)`)
    if (!dni) return
    try {
      await dispatchService.cargarDniDeProfesional(p.professionalId, dni)
      setProfesionales(await dispatchService.listarProfesionalesDeEntidad(entidad.id))
      toast.success('DNI cargado')
    } catch (err) { toast.error(err?.message || 'No pudimos cargar el DNI') }
  }
  const quitarProfesional = async (p) => {
    try {
      await dispatchService.quitarProfesionalDeEntidad(p.id)
      setProfesionales(ps => ps.filter(x => x.id !== p.id))
    } catch (err) { toast.error(err?.message || 'No pudimos quitarlo') }
  }

  const desconectarMp = async () => {
    if (!confirm('¿Desconectar Mercado Pago? Las emergencias nuevas se van a cobrar con la cuenta de Healthier hasta reconectar.')) return
    setDesconectando(true)
    const { error } = await dispatchService.disconnectMp()
    setDesconectando(false)
    if (error) return toast.error(`No pudimos desconectar Mercado Pago: ${error}`)
    toast.success('Mercado Pago desconectado')
    setMp({ conectado: false })
  }

  useEffect(() => {
    dispatchService.miEntidad().then(async e => {
      setEntidad(e)
      if (e) {
        setForm({
          name: e.name ?? '',
          legalName: e.legalName ?? '',
          phone: e.phone ?? '',
          address: e.address ?? '',
          dispatchPhone: e.dispatchPhone ?? '',
          color: e.color ?? '#DC2626',
        })
        dispatchService.listarProfesionalesDeEntidad(e.id).then(setProfesionales).catch(() => {})
        dispatchService.ingresosEnModoOperador().then(setIngresos).catch(() => {})
        try {
          setStaff(await dispatchService.listarStaff(e.id))
        } catch {
          toast.error('Error al cargar el equipo')
        }
      }
      setLoading(false)
    }).catch(() => { toast.error('Error al cargar la entidad'); setLoading(false) })
  }, [])

  const save = async (e) => {
    e.preventDefault()
    if (!isAdmin || !entidad) return
    setSaving(true)
    try {
      const updated = await dispatchService.actualizarEntidad(entidad.id, form)
      setEntidad(updated)
      toast.success('Configuración guardada')
    } catch (err) {
      toast.error(err?.message || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 h-40 bg-bg-surface rounded-lg animate-pulse" />

  return (
    <div className="space-y-6 animate-fade-in max-w-xl">
      <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
        <Gear className="h-6 w-6 text-brand" /> Configuración
      </h1>

      {!isAdmin && (
        <div className="card flex items-center gap-2 text-text-secondary text-sm">
          <Lock className="h-4 w-4 shrink-0" /> Solo el Administrador puede editar estos datos.
        </div>
      )}

      {isAdmin && (
        <div className="card space-y-4">
          <div>
            <h2 className="font-semibold text-text-primary">Mercado Pago</h2>
            <p className="text-sm text-text-secondary mt-0.5">Las emergencias se cobran vía Mercado Pago y se acreditan directo en la cuenta de la entidad.</p>
          </div>
          {mp?.conectado ? (
            <div className="flex items-center gap-4 p-4 rounded-xl border border-emerald-200 bg-emerald-50">
              <div className="w-11 h-11 rounded-xl bg-white border border-emerald-200 flex items-center justify-center shrink-0">
                <MercadoPagoMark className="w-7 h-7" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary">Mercado Pago conectado</p>
                <p className="text-xs text-text-secondary mt-0.5 truncate">{mp.nickname || mp.email || 'Las emergencias se cobran a esta cuenta.'}</p>
              </div>
              <button type="button" onClick={desconectarMp} disabled={desconectando} className="text-xs font-semibold text-red-600 hover:underline shrink-0 disabled:opacity-50">
                {desconectando ? 'Desconectando...' : 'Desconectar'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-4 p-4 rounded-xl border border-red-200 bg-red-50">
              <div className="w-11 h-11 rounded-xl bg-white border border-red-200 flex items-center justify-center shrink-0">
                <MercadoPagoMark className="w-7 h-7" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary">No conectado</p>
                <p className="text-xs text-text-secondary mt-0.5">Hasta conectar la cuenta de la entidad, las emergencias se cobran con la cuenta de Healthier.</p>
              </div>
              <button type="button" onClick={conectarMp} disabled={conectandoMp} className="flex items-center gap-1.5 text-xs font-semibold text-white bg-brand px-3 py-2 rounded-full hover:bg-brand-hover transition-colors shrink-0 disabled:opacity-60">
                <LinkSimple className="h-3.5 w-3.5" /> {conectandoMp ? 'Abriendo…' : 'Conectar'}
              </button>
            </div>
          )}
        </div>
      )}

      <form onSubmit={save} className="card space-y-4">
        <h2 className="font-semibold text-text-primary">Datos de la entidad</h2>
        <div>
          <label className="form-label">Nombre</label>
          <input
            className="form-input"
            disabled={!isAdmin}
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <label className="form-label">Razón social</label>
          <input
            className="form-input"
            disabled={!isAdmin}
            value={form.legalName}
            onChange={e => setForm(f => ({ ...f, legalName: e.target.value }))}
          />
        </div>
        <div>
          <label className="form-label">Teléfono</label>
          <input
            className="form-input"
            disabled={!isAdmin}
            value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
          />
        </div>
        <div>
          <label className="form-label">Dirección</label>
          <input
            className="form-input"
            disabled={!isAdmin}
            value={form.address}
            onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
          />
        </div>
        <div>
          <label className="form-label">Teléfono de guardia</label>
          <input
            className="form-input"
            disabled={!isAdmin}
            placeholder="El que ve el paciente en un código ROJO"
            value={form.dispatchPhone}
            onChange={e => setForm(f => ({ ...f, dispatchPhone: e.target.value }))}
          />
        </div>
        <div>
          <label className="form-label">Color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              disabled={!isAdmin}
              className="w-10 h-10 rounded-lg border border-border-default cursor-pointer disabled:cursor-not-allowed"
              value={form.color}
              onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
            />
            <input
              className="form-input flex-1"
              disabled={!isAdmin}
              value={form.color}
              onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
            />
          </div>
        </div>
        {isAdmin && (
          <button className="btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
        )}
      </form>

      <div className="card space-y-3">
        <h2 className="font-semibold text-text-primary">Profesionales de la entidad</h2>
        <p className="text-xs text-text-secondary">Si quien entra con una cuenta operador pone el DNI de alguien de esta lista, esa cuenta actúa ese día como ese profesional: la emergencia, la historia clínica y la receta quedan a su nombre.</p>
        {profesionales.length === 0 ? (
          <p className="text-sm text-text-secondary">Todavía no cargaron profesionales</p>
        ) : (
          <div className="space-y-2">
            {profesionales.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="text-text-primary font-medium truncate">{p.profile?.fullName || p.profile?.email}</p>
                  <p className="text-xs text-text-secondary">
                    {p.profile?.dni ? `DNI ${p.profile.dni}` : 'Sin DNI cargado: no va a poder ingresar'}{!p.verificado ? ' · sin verificar' : ''}
                  </p>
                </div>
                {isAdmin && !p.profile?.dni && <button type="button" onClick={() => cargarDni(p)} className="text-xs font-semibold text-brand hover:underline shrink-0">Cargar DNI</button>}
                {isAdmin && <button type="button" onClick={() => quitarProfesional(p)} className="text-xs font-semibold text-red-600 hover:underline shrink-0">Quitar</button>}
              </div>
            ))}
          </div>
        )}
        {isAdmin && (
          <div className="space-y-2">
            <input className="form-input" placeholder="Buscar un profesional por nombre" value={busca} onChange={e => buscarProfesional(e.target.value)} />
            {candidatos.map(c => (
              <button key={c.id} type="button" onClick={() => agregarProfesional(c)} className="w-full text-left text-sm px-3 py-2 rounded-lg border border-border-default hover:bg-bg-surface">
                {c.fullName} <span className="text-xs text-text-secondary">· {c.email}</span>
              </button>
            ))}
          </div>
        )}
        {ingresos.length > 0 && (
          <div className="pt-2 border-t border-border-default space-y-1">
            <p className="text-xs font-semibold text-text-secondary">Ingresos en modo operador (últimos días)</p>
            {ingresos.map(i => (
              <p key={i.id} className="text-xs text-text-secondary">{i.dia} · {i.operador?.email} entró como {i.profesional?.fullName} (DNI {i.dniIngresado})</p>
            ))}
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold text-text-primary">Operadores de los últimos días</h2>
        <p className="text-xs text-text-secondary">Quién estuvo detrás de cada cuenta operador. El paciente ve sólo el nombre y la foto.</p>
        {operadores.length === 0 ? (
          <p className="text-sm text-text-secondary">Todavía no hay registros</p>
        ) : (
          <div className="space-y-3">
            {operadores.map(o => <FilaOperador key={o.id} o={o} />)}
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold text-text-primary">Equipo</h2>
        {staff.length === 0 ? (
          <p className="text-sm text-text-secondary">No hay staff registrado</p>
        ) : (
          <div className="space-y-2">
            {staff.map(s => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-text-primary font-medium">{s.profile?.fullName || '—'}</p>
                  <p className="text-text-secondary text-xs">{s.profile?.email}</p>
                </div>
                <span className="text-xs text-text-tertiary">{s.profile?.role}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
