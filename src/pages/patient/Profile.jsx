import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  User, PencilSimple, Check, Camera, ShieldCheck, Heartbeat,
  Phone, Users, CreditCard, Receipt, SignOut, ArrowLeft,
  FileText, Trash, Bell, CaretRight,
} from '@phosphor-icons/react'
import { profilesService } from '../../services/profilesService'
import { authService } from '../../services/authService'
import { mpService } from '../../services/mpService'
import { familyService } from '../../services/familyService'
import { consultationsService } from '../../services/consultationsService'
import { toast } from '../../components/Toast'
import PatientSheet from '../../components/patient/PatientSheet'
import MPCardHolder from '../../components/payment/MPCardHolder'
import { brandLabel } from '../../components/payment/cardBrand'
import { notificationService } from '../../services/notificationService'
import { track } from '../../utils/analytics'

// Mismas etiquetas y formato que /paciente/comprobantes, para que el resumen del
// perfil y la página completa no digan cosas distintas de la misma consulta.
const RECEIPT_LABEL = {
  video:      'Videoconsulta',
  presencial: 'Consulta presencial',
  emergency:  'Emergencia',
}

function formatARS(n) {
  if (!n) return '—'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

function formatReceiptDate(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function PatientProfile({ profile, onProfileUpdate }) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [userData, setUserData] = useState({
    nombre:           profile?.fullName      || '',
    email:            profile?.email         || '',
    telefono:         profile?.phone         || '',
    domicilio:        profile?.address       || '',
    dni:              profile?.dni           || '',
    sangre:           profile?.bloodType     || '',
    obraSocial:       profile?.insuranceName || '',
    numeroSocio:      profile?.insuranceNum  || '',
    emergenciaNombre: profile?.emergencyName || '',
    emergenciaTelefono: profile?.emergencyPhone || '',
    emergenciaVinculo: profile?.emergencyRel  || '',
  })
  // Grupo familiar — persistido en `family_members` (migración 068)
  const [familiares, setFamiliares] = useState([])
  const [familiaresLoading, setFamiliaresLoading] = useState(true)
  const [savingFamiliar, setSavingFamiliar] = useState(false)
  const [deletingFamiliarId, setDeletingFamiliarId] = useState(null)
  const [showAddFamiliar, setShowAddFamiliar] = useState(false)
  const [newFamiliar, setNewFamiliar] = useState({ nombre: '', vinculo: '', dni: '', email: '', telefono: '', obraSocial: '', numeroSocio: '' })

  // Comprobantes — mismas consultas cobradas que muestra /paciente/comprobantes.
  // Acá va solo un resumen; la lista completa vive en esa página.
  const [comprobantes, setComprobantes] = useState([])
  const [comprobantesLoading, setComprobantesLoading] = useState(true)

  // Saved cards — real, from `payment_methods` via mp-save-card (never raw PAN)
  const [tarjetas, setTarjetas] = useState([])
  const [tarjetasLoading, setTarjetasLoading] = useState(true)
  const [tarjetasError, setTarjetasError] = useState(null)
  const [deletingTarjetaId, setDeletingTarjetaId] = useState(null)
  const [showTarjeta, setShowTarjeta] = useState(false)
  const [mpPublicKey, setMpPublicKey] = useState(null)

  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushTogglingOn, setPushTogglingOn] = useState(false)

  useEffect(() => {
    setPushEnabled(notificationService.isSupported() && notificationService.isPushEnabled())
  }, [])

  const handleTogglePush = async () => {
    if (pushEnabled) {
      await notificationService.unsubscribe(profile?.id)
      setPushEnabled(false)
      track('notifications_toggle', { channel: 'push', enabled: false })
      toast.info('Notificaciones desactivadas')
    } else {
      setPushTogglingOn(true)
      const ok = await notificationService.subscribe(profile?.id)
      setPushEnabled(ok)
      if (ok) {
        toast.success('Notificaciones activadas')
        track('notifications_toggle', { channel: 'push', enabled: true })
      } else {
        toast.error('No se pudo activar las notificaciones')
      }
      setPushTogglingOn(false)
    }
  }

  const toggleEdit = async () => {
    if (editing) {
      try {
        await profilesService.update(profile.id, {
          full_name: userData.nombre,
          phone: userData.telefono,
          address: userData.domicilio,
          blood_type: userData.sangre || null,
          insurance_name: userData.obraSocial,
          insurance_num: userData.numeroSocio,
          emergency_name: userData.emergenciaNombre,
          emergency_phone: userData.emergenciaTelefono,
          emergency_rel: userData.emergenciaVinculo,
        })
        if (onProfileUpdate) onProfileUpdate({ ...profile, fullName: userData.nombre })
        toast.success('Perfil actualizado')
      } catch {
        toast.error('Error al guardar perfil')
      }
    } else {
      track('profile_edit_click', { section: 'informacion_basica' })
    }
    setEditing(!editing)
  }

  const field = (label, name, type = 'text') => (
    <div className="flex flex-col">
      <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-widest mb-1.5 ml-1">{label}</label>
      {editing
        ? <input type={type} value={userData[name]} onChange={e => setUserData(p => ({ ...p, [name]: e.target.value }))} className="bg-bg-primary border border-border-default rounded-2xl px-4 py-3.5 outline-none text-[16px] font-medium text-text-primary focus:border-brand" />
        : <div className="px-1 py-1 text-[17px] font-medium text-text-primary">{userData[name] || '—'}</div>
      }
    </div>
  )

  const loadTarjetas = useCallback(async () => {
    setTarjetasLoading(true)
    setTarjetasError(null)
    const { data, error } = await mpService.getMyCards()
    setTarjetasLoading(false)
    if (error) {
      setTarjetasError('No pudimos cargar tus tarjetas.')
      return
    }
    setTarjetas(data ?? [])
  }, [])

  useEffect(() => { loadTarjetas() }, [loadTarjetas])

  useEffect(() => {
    mpService.getPaymentPlatformConfig().then(({ data }) => {
      setMpPublicKey(data?.publicKey ?? null)
    }).catch(() => setMpPublicKey(null))
  }, [])

  const handleDeleteTarjeta = async id => {
    setDeletingTarjetaId(id)
    const { error } = await mpService.deleteCard(id)
    setDeletingTarjetaId(null)
    if (error) {
      toast.error('No pudimos eliminar la tarjeta. Intentá de nuevo.')
      return
    }
    setTarjetas(prev => prev.filter(t => t.id !== id))
    toast.success('Tarjeta eliminada')
  }

  const handleTarjetaSaved = () => {
    setShowTarjeta(false)
    toast.success('Tarjeta guardada')
    loadTarjetas()
  }

  // ── Grupo familiar ────────────────────────────────────────
  const loadFamiliares = useCallback(async () => {
    if (!profile?.id) return
    setFamiliaresLoading(true)
    try {
      setFamiliares(await familyService.listForPatient(profile.id))
    } catch {
      toast.error('No pudimos cargar tu grupo familiar.')
    } finally {
      setFamiliaresLoading(false)
    }
  }, [profile?.id])

  useEffect(() => { loadFamiliares() }, [loadFamiliares])

  const saveNuevoFamiliar = async () => {
    if (!newFamiliar.nombre.trim() || savingFamiliar) return
    setSavingFamiliar(true)
    try {
      const created = await familyService.create(profile.id, {
        fullName:      newFamiliar.nombre.trim(),
        relationship:  newFamiliar.vinculo || null,
        dni:           newFamiliar.dni || null,
        email:         newFamiliar.email || null,
        phone:         newFamiliar.telefono || null,
        insuranceName: newFamiliar.obraSocial || null,
        insuranceNum:  newFamiliar.numeroSocio || null,
      })
      setFamiliares(prev => [created, ...prev])
      setShowAddFamiliar(false)
      setNewFamiliar({ nombre: '', vinculo: '', dni: '', email: '', telefono: '', obraSocial: '', numeroSocio: '' })
      toast.success('Familiar añadido')
    } catch {
      toast.error('No pudimos guardar el familiar. Intentá de nuevo.')
    } finally {
      setSavingFamiliar(false)
    }
  }

  const handleDeleteFamiliar = async id => {
    setDeletingFamiliarId(id)
    try {
      await familyService.remove(id)
      setFamiliares(prev => prev.filter(f => f.id !== id))
      toast.success('Familiar eliminado')
    } catch {
      toast.error('No pudimos eliminar el familiar.')
    } finally {
      setDeletingFamiliarId(null)
    }
  }

  // ── Comprobantes ──────────────────────────────────────────
  useEffect(() => {
    if (!profile?.id) return
    consultationsService.getReceiptsForPatient(profile.id)
      .then(rows => setComprobantes(rows.filter(r => r.paymentStatus === 'paid')))
      .catch(() => {})
      .finally(() => setComprobantesLoading(false))
  }, [profile?.id])

  // Main profile view
  return (
    <div className="absolute inset-0 bg-bg-primary pt-6 sm:pt-8 pb-32 px-6 overflow-y-auto animate-fade-in scrollbar-hide">
      <div className="max-w-lg mx-auto">
      <div className="flex justify-between items-center mb-8 mt-4">
        <h1 className="text-2xl sm:text-3xl font-light text-text-primary tracking-tight leading-none">Mi Perfil</h1>
        <button
          onClick={toggleEdit}
          className={`bg-white px-4 py-2 rounded-full font-semibold text-[13px] shadow-sm flex items-center gap-2 border ${editing ? 'border-emerald-200 text-emerald-600' : 'border-border-default text-text-secondary'} hover:bg-bg-primary transition-colors`}
        >
          {editing ? <><Check className="w-4 h-4" /> Guardar</> : <><PencilSimple className="w-4 h-4" /> Editar</>}
        </button>
      </div>

      {/* Avatar */}
      <div className="flex justify-center mb-8">
        <div className="relative">
          <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-white shadow-sm bg-bg-primary flex items-center justify-center">
            {profile?.avatarUrl
              ? <img src={profile.avatarUrl} alt="Usuario" className="w-full h-full object-cover" />
              : <User className="w-12 h-12 text-text-tertiary" />
            }
            {editing && (
              <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center cursor-pointer animate-fade-in rounded-full">
                <Camera className="w-8 h-8 text-white" />
              </div>
            )}
          </div>
          {!editing && (
            <div className="absolute bottom-1 right-1 bg-brand p-2 rounded-full border-[3px] border-white shadow-sm">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
          )}
        </div>
      </div>

      {/* Basic info */}
      <div className="bg-bg-secondary rounded-2xl p-6 shadow-sm border border-border-default mb-6">
        <h3 className="font-semibold text-[18px] text-text-primary mb-6 flex items-center gap-2"><User className="w-5 h-5 text-brand" /> Información Básica</h3>
        <div className="space-y-5">
          {field('Nombre', 'nombre')}
          {field('Email', 'email', 'email')}
          {field('Teléfono', 'telefono', 'tel')}
          {field('Domicilio', 'domicilio')}
        </div>
      </div>

      {/* Clinical profile */}
      <div className="bg-bg-secondary rounded-2xl p-6 shadow-sm border border-border-default mb-6">
        <h3 className="font-semibold text-[18px] text-text-primary mb-6 flex items-center gap-2"><Heartbeat className="w-5 h-5 text-brand" /> Perfil Clínico</h3>
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            {field('DNI', 'dni')}
            <div className="flex flex-col">
              <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-widest mb-1.5 ml-1">Sangre</label>
              {editing
                ? <select value={userData.sangre} onChange={e => setUserData(p => ({ ...p, sangre: e.target.value }))} className="bg-bg-primary border border-border-default rounded-2xl px-4 py-3.5 outline-none text-[16px] font-medium text-text-primary focus:border-brand">
                    <option value="">Seleccioná</option>
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(b => <option key={b}>{b}</option>)}
                  </select>
                : <div className="px-1 py-1 text-[17px] font-medium text-text-primary">{userData.sangre || '—'}</div>
              }
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field('Obra Social', 'obraSocial')}
            {field('N° Afiliado', 'numeroSocio')}
          </div>
        </div>
      </div>

      {/* Emergency contact */}
      <div className="bg-bg-secondary rounded-2xl p-6 shadow-sm border border-border-default mb-6">
        <h3 className="font-semibold text-[18px] text-text-primary mb-6 flex items-center gap-2"><Phone className="w-5 h-5 text-red-500" /> Contacto de Emergencia</h3>
        <div className="space-y-5">
          {field('Nombre Completo', 'emergenciaNombre')}
          <div className="grid grid-cols-2 gap-4">
            {field('Teléfono', 'emergenciaTelefono', 'tel')}
            {field('Vínculo', 'emergenciaVinculo')}
          </div>
        </div>
      </div>

      {/* Family group */}
      <div className="bg-bg-secondary rounded-2xl p-6 shadow-sm border border-border-default mb-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-semibold text-[18px] text-text-primary flex items-center gap-2"><Users className="w-5 h-5 text-emerald-500" /> Grupo Familiar</h3>
          {!editing && <span onClick={() => { track('family_member_add_click', {}); setShowAddFamiliar(true) }} className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full cursor-pointer hover:bg-emerald-100 transition-colors">+ AÑADIR</span>}
        </div>
        {familiaresLoading
          ? <p className="text-sm text-text-tertiary text-center py-4">Cargando tu grupo familiar…</p>
          : familiares.length === 0
            ? <p className="text-sm text-text-tertiary text-center py-4">No hay familiares vinculados.</p>
            : familiares.map(f => (
              <div key={f.id} className="bg-bg-primary rounded-2xl p-4 border border-border-default mb-3">
                <div className="flex justify-between items-center gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[16px] text-text-primary truncate">{f.fullName}</p>
                    {f.relationship && (
                      <span className="inline-block text-[12px] font-semibold text-emerald-700 bg-emerald-100 py-0.5 px-2 rounded-md mt-1">{f.relationship}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <p className="text-[14px] text-text-tertiary">{f.insuranceName || '—'}</p>
                    {editing && (
                      <button
                        onClick={() => handleDeleteFamiliar(f.id)}
                        disabled={deletingFamiliarId === f.id}
                        aria-label="Eliminar familiar"
                        className="p-2 bg-white rounded-full text-danger shadow-sm disabled:opacity-40"
                      ><Trash className="w-4 h-4" /></button>
                    )}
                  </div>
                </div>
              </div>
            ))
        }
      </div>

      {/* Payment info */}
      <div className="bg-bg-secondary rounded-2xl p-6 shadow-sm border border-border-default mb-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-semibold text-[18px] text-text-primary flex items-center gap-2"><CreditCard className="w-5 h-5 text-brand" /> Info. de Pago</h3>
          {!editing && (
            <span
              onClick={() => { track('payment_method_add_click', {}); setShowTarjeta(true) }}
              className="text-[11px] font-semibold text-brand bg-brand-muted px-3 py-1.5 rounded-full cursor-pointer hover:bg-brand-light"
            >+ AÑADIR</span>
          )}
        </div>
        <div className="space-y-4">
          {tarjetasLoading && (
            <p className="text-sm text-text-tertiary text-center py-4">Cargando tus tarjetas…</p>
          )}

          {!tarjetasLoading && tarjetasError && (
            <div className="text-center py-4">
              <p className="text-sm text-danger">{tarjetasError}</p>
              <button onClick={loadTarjetas} className="mt-1 text-xs font-semibold text-danger underline underline-offset-2">Reintentar</button>
            </div>
          )}

          {!tarjetasLoading && !tarjetasError && tarjetas.length === 0 && (
            <p className="text-sm text-text-tertiary text-center py-4">
              No tenés tarjetas guardadas. Podés añadir una para pagar más rápido.
            </p>
          )}

          {!tarjetasLoading && !tarjetasError && tarjetas.map(t => (
            <div key={t.id} className="bg-bg-primary rounded-2xl p-4 border border-border-default flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-8 rounded-md flex items-center justify-center bg-white border border-border-default shadow-sm">
                  <CreditCard className="w-4 h-4 text-brand" weight="fill" />
                </div>
                <div>
                  <p className="font-semibold text-text-primary text-[15px]">•••• {t.lastFour ?? '????'}</p>
                  <p className="text-[12px] font-medium text-text-secondary">{brandLabel(t.cardBrand)}</p>
                </div>
              </div>
              {editing
                ? <button
                    onClick={() => handleDeleteTarjeta(t.id)}
                    disabled={deletingTarjetaId === t.id}
                    aria-label="Eliminar tarjeta"
                    className="p-2 bg-white rounded-full text-danger shadow-sm disabled:opacity-40"
                  ><Trash className="w-4 h-4" /></button>
                : <Check className="w-5 h-5 text-emerald-500" />
              }
            </div>
          ))}
        </div>
      </div>

      {/* Receipts */}
      <div className="bg-bg-secondary rounded-2xl p-6 shadow-sm border border-border-default mb-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-semibold text-[18px] text-text-primary flex items-center gap-2"><Receipt className="w-5 h-5 text-text-tertiary" /> Comprobantes</h3>
          {comprobantes.length > 0 && (
            <button
              onClick={() => navigate('/paciente/comprobantes')}
              className="text-[11px] font-semibold text-brand bg-brand-muted px-3 py-1.5 rounded-full hover:bg-brand-light transition-colors flex items-center gap-1"
            >VER TODOS <CaretRight className="w-3 h-3" /></button>
          )}
        </div>
        {comprobantesLoading
          ? <p className="text-sm text-text-tertiary text-center py-4">Cargando tus comprobantes…</p>
          : comprobantes.length === 0
            ? <p className="text-sm text-text-tertiary text-center py-4">No tenés comprobantes aún.</p>
            : comprobantes.slice(0, 3).map(c => (
              <div
                key={c.id}
                onClick={() => navigate('/paciente/comprobantes')}
                className="bg-bg-primary rounded-2xl p-4 border border-border-default flex items-center justify-between hover:border-brand cursor-pointer group mb-3 transition-colors"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center shrink-0"><FileText className="w-5 h-5 text-emerald-600" /></div>
                  <div className="min-w-0">
                    <p className="font-semibold text-text-primary text-[14px] truncate">{RECEIPT_LABEL[c.modality] ?? 'Consulta'}</p>
                    <p className="text-[12px] text-text-tertiary mt-0.5">{formatReceiptDate(c.scheduledAt || c.completedAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-semibold text-[15px] text-text-primary">{formatARS(c.priceAtBooking)}</span>
                  <CaretRight className="w-4 h-4 text-text-tertiary group-hover:text-brand transition-colors" />
                </div>
              </div>
            ))
        }
      </div>

      {/* Notifications section */}
      {!editing && notificationService.isSupported() && (
        <div className="bg-white rounded-2xl p-5 border border-border-default shadow-sm">
          <h3 className="font-semibold text-[18px] text-text-primary flex items-center gap-2 mb-4">
            <Bell className="w-5 h-5 text-brand" /> Notificaciones
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-text-primary text-sm">Notificaciones push</p>
              <p className="text-xs text-text-secondary mt-0.5">Confirmaciones de turno y alertas</p>
            </div>
            <button
              onClick={handleTogglePush}
              disabled={pushTogglingOn}
              className={`relative inline-flex h-7 w-[52px] items-center rounded-full transition-colors focus:outline-none ${pushEnabled ? 'bg-brand' : 'bg-border-default'}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${pushEnabled ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </div>
          {Notification.permission === 'denied' && (
            <p className="text-xs text-text-tertiary mt-2">Para activar notificaciones, permitilas en la configuración de tu navegador.</p>
          )}
        </div>
      )}

      {!editing && (
        <button
          onClick={async () => { track('logout', {}); await authService.logout(); navigate('/') }}
          className="w-full bg-danger/10 text-danger py-4 rounded-[20px] font-semibold text-[16px] flex justify-center items-center gap-2 hover:bg-danger/15 transition-colors"
        >
          <SignOut className="w-5 h-5" /> Cerrar Sesión
        </button>
      )}
      </div>{/* end max-w-lg */}

      {/* Añadir Familiar — responsive sheet/modal */}
      <PatientSheet open={showAddFamiliar} onClose={() => setShowAddFamiliar(false)} maxWidth="max-w-md">
        <div className="px-6 pt-4 pb-2 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowAddFamiliar(false)} className="w-10 h-10 bg-white border border-border-default rounded-full flex items-center justify-center shadow-sm hover:bg-bg-primary">
              <ArrowLeft className="w-5 h-5 text-text-secondary" />
            </button>
            <h2 className="text-xl font-semibold text-text-primary">Añadir Familiar</h2>
          </div>
          <button onClick={saveNuevoFamiliar} className="text-emerald-700 font-semibold px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-full hover:bg-emerald-100 text-sm">Guardar</button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-hide p-6 space-y-6 pb-8 bg-bg-primary">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-border-default space-y-5">
            {[['Nombre Completo', 'nombre'], ['Vínculo', 'vinculo'], ['DNI', 'dni']].map(([lbl, nm]) => (
              <div key={nm} className="flex flex-col">
                <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-widest mb-1.5 ml-1">{lbl}</label>
                <input type="text" value={newFamiliar[nm]} onChange={e => setNewFamiliar(p => ({ ...p, [nm]: e.target.value }))} className="bg-bg-primary border border-border-default rounded-2xl px-4 py-3.5 outline-none text-[15px] font-medium text-text-primary focus:border-brand" />
              </div>
            ))}
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-border-default space-y-5">
            <div className="grid grid-cols-2 gap-4">
              {[['Obra Social', 'obraSocial'], ['N° Afiliado', 'numeroSocio']].map(([lbl, nm]) => (
                <div key={nm} className="flex flex-col">
                  <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-widest mb-1.5 ml-1">{lbl}</label>
                  <input type="text" value={newFamiliar[nm]} onChange={e => setNewFamiliar(p => ({ ...p, [nm]: e.target.value }))} className="bg-bg-primary border border-border-default rounded-2xl px-4 py-3.5 outline-none text-[15px] font-medium text-text-primary focus:border-brand" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </PatientSheet>

      {/* Añadir Tarjeta — Brick de Mercado Pago (los datos nunca tocan nuestro servidor) */}
      <PatientSheet open={showTarjeta} onClose={() => setShowTarjeta(false)} maxWidth="max-w-md">
        <div className="px-6 pt-4 pb-4 flex justify-between items-center flex-shrink-0 border-b border-border-default">
          <button onClick={() => setShowTarjeta(false)} className="w-10 h-10 bg-white border border-border-default shadow-sm rounded-full flex items-center justify-center hover:bg-bg-primary">
            <ArrowLeft className="w-5 h-5 text-text-secondary" />
          </button>
          <p className="font-semibold text-[15px] text-text-primary">Añadir tarjeta</p>
          <div className="w-10" />
        </div>
        <div className="overflow-y-auto scrollbar-hide flex-1 p-6 pb-8 bg-bg-primary">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-border-default">
            {mpPublicKey ? (
              <MPCardHolder
                publicKey={mpPublicKey}
                mode="save"
                payerEmail={userData.email}
                submitLabel="Guardar tarjeta"
                onSuccess={handleTarjetaSaved}
                onError={err => toast.error(err || 'No pudimos guardar la tarjeta.')}
              />
            ) : (
              <p className="text-sm text-text-secondary text-center py-6">
                Guardar tarjetas no está disponible en este momento. Probá de nuevo más tarde.
              </p>
            )}
          </div>
          <p className="text-[12px] text-text-tertiary text-center mt-4 px-4">
            Los datos de tu tarjeta se procesan directamente con Mercado Pago. Healthier solo guarda la marca y los últimos 4 dígitos.
          </p>
        </div>
      </PatientSheet>
    </div>
  )
}
