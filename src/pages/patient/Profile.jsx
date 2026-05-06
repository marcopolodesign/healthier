import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  User, Edit3, Check, Camera, ShieldCheck, Stethoscope,
  Phone, Users, CreditCard, Receipt, LogOut, ArrowLeft,
  FileText, Trash2, Download, Plus,
} from 'lucide-react'
import { profilesService } from '../../services/profilesService'
import { authService } from '../../services/authService'
import { toast } from '../../components/Toast'
import PatientSheet from '../../components/patient/PatientSheet'

export default function PatientProfile({ profile, onProfileUpdate }) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [userData, setUserData] = useState({
    nombre:           profile?.fullName      || '',
    email:            profile?.email         || '',
    telefono:         profile?.phone         || '',
    domicilio:        profile?.address       || '',
    dni:              profile?.dni           || '',
    sangre:           profile?.bloodType     || 'O Positivo',
    obraSocial:       profile?.insuranceName || '',
    numeroSocio:      profile?.insuranceNum  || '',
    emergenciaNombre: profile?.emergencyName || '',
    emergenciaTelefono: profile?.emergencyPhone || '',
    emergenciaVinculo: profile?.emergencyRel  || '',
  })
  // Local-state-only: familiares, tarjetas, comprobantes (persistence deferred)
  const [familiares, setFamiliares] = useState([])
  const [tarjetas, setTarjetas] = useState([
    { id: 1, numero: '**** **** **** 4242', titular: userData.nombre, vencimiento: '12/28', cvv: '***', marca: 'VISA' }
  ])
  const [comprobantes] = useState([])
  const [showAddFamiliar, setShowAddFamiliar] = useState(false)
  const [newFamiliar, setNewFamiliar] = useState({ nombre: '', vinculo: '', dni: '', email: '', telefono: '', obraSocial: '', numeroSocio: '' })
  const [showTarjeta, setShowTarjeta] = useState(false)
  const [tarjetaForm, setTarjetaForm] = useState({ id: null, numero: '', titular: '', vencimiento: '', cvv: '', marca: 'VISA' })

  const toggleEdit = async () => {
    if (editing) {
      try {
        await profilesService.update(profile.id, {
          full_name: userData.nombre,
          phone: userData.telefono,
          address: userData.domicilio,
          blood_type: userData.sangre,
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
    }
    setEditing(!editing)
  }

  const field = (label, name, type = 'text') => (
    <div className="flex flex-col">
      <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">{label}</label>
      {editing
        ? <input type={type} value={userData[name]} onChange={e => setUserData(p => ({ ...p, [name]: e.target.value }))} className="bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3.5 outline-none text-[16px] font-medium text-gray-900 focus:border-brand" />
        : <div className="px-1 py-1 text-[17px] font-medium text-gray-900">{userData[name] || '—'}</div>
      }
    </div>
  )

  const handleTarjetaChange = e => {
    const { name, value } = e.target
    setTarjetaForm(prev => {
      const updated = { ...prev, [name]: value }
      if (name === 'numero') {
        updated.marca = value.startsWith('5') ? 'MASTERCARD' : value.startsWith('3') ? 'AMEX' : 'VISA'
      }
      return updated
    })
  }

  const saveTarjeta = () => {
    if (!tarjetaForm.numero) return
    if (tarjetaForm.id) {
      setTarjetas(prev => prev.map(t => t.id === tarjetaForm.id ? { ...tarjetaForm, cvv: '***', numero: tarjetaForm.numero.includes('*') ? tarjetaForm.numero : `**** **** **** ${tarjetaForm.numero.slice(-4)}` } : t))
    } else {
      setTarjetas(prev => [...prev, { ...tarjetaForm, id: Date.now(), cvv: '***', numero: `**** **** **** ${tarjetaForm.numero.slice(-4)}` }])
    }
    setShowTarjeta(false)
  }

  const saveNuevoFamiliar = () => {
    if (!newFamiliar.nombre) return
    setFamiliares(prev => [...prev, { ...newFamiliar, id: Date.now() }])
    setShowAddFamiliar(false)
    setNewFamiliar({ nombre: '', vinculo: '', dni: '', email: '', telefono: '', obraSocial: '', numeroSocio: '' })
  }

  // Main profile view
  return (
    <div className="absolute inset-0 bg-bg-primary pt-6 sm:pt-8 pb-32 px-6 overflow-y-auto animate-fade-in scrollbar-hide">
      <div className="max-w-lg mx-auto">
      <div className="flex justify-between items-center mb-8 mt-4">
        <h1 className="text-[32px] font-black text-gray-900 tracking-tight leading-none">Mi Perfil</h1>
        <button
          onClick={toggleEdit}
          className={`bg-white px-4 py-2 rounded-full font-bold text-[13px] shadow-sm flex items-center gap-2 border ${editing ? 'border-emerald-200 text-emerald-600' : 'border-gray-200 text-gray-700'} hover:bg-gray-50 transition-colors`}
        >
          {editing ? <><Check className="w-4 h-4" /> Guardar</> : <><Edit3 className="w-4 h-4" /> Editar</>}
        </button>
      </div>

      {/* Avatar */}
      <div className="flex justify-center mb-8">
        <div className="relative">
          <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-white shadow-md bg-gray-100 flex items-center justify-center">
            {profile?.avatarUrl
              ? <img src={profile.avatarUrl} alt="Usuario" className="w-full h-full object-cover" />
              : <User className="w-12 h-12 text-gray-300" />
            }
            {editing && (
              <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center cursor-pointer animate-fade-in rounded-full">
                <Camera className="w-8 h-8 text-white" />
              </div>
            )}
          </div>
          {!editing && (
            <div className="absolute bottom-1 right-1 bg-brand p-2 rounded-full border-[3px] border-white shadow-md">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
          )}
        </div>
      </div>

      {/* Basic info */}
      <div className="bg-bg-secondary rounded-[32px] p-6 shadow-sm border border-border-default mb-6">
        <h3 className="font-black text-lg text-gray-900 mb-6 flex items-center gap-2"><User className="w-5 h-5 text-brand" /> Información Básica</h3>
        <div className="space-y-5">
          {field('Nombre', 'nombre')}
          {field('Email', 'email', 'email')}
          {field('Teléfono', 'telefono', 'tel')}
          {field('Domicilio', 'domicilio')}
        </div>
      </div>

      {/* Clinical profile */}
      <div className="bg-bg-secondary rounded-[32px] p-6 shadow-sm border border-border-default mb-6">
        <h3 className="font-black text-lg text-gray-900 mb-6 flex items-center gap-2"><Stethoscope className="w-5 h-5 text-brand" /> Perfil Clínico</h3>
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            {field('DNI', 'dni')}
            <div className="flex flex-col">
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Sangre</label>
              {editing
                ? <select value={userData.sangre} onChange={e => setUserData(p => ({ ...p, sangre: e.target.value }))} className="bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3.5 outline-none text-[16px] font-medium text-gray-900 focus:border-brand">
                    {['O Positivo', 'O Negativo', 'A Positivo', 'A Negativo', 'B Positivo', 'B Negativo', 'AB Positivo', 'AB Negativo'].map(b => <option key={b}>{b}</option>)}
                  </select>
                : <div className="px-1 py-1 text-[17px] font-medium text-gray-900">{userData.sangre}</div>
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
      <div className="bg-bg-secondary rounded-[32px] p-6 shadow-sm border border-border-default mb-6">
        <h3 className="font-black text-lg text-gray-900 mb-6 flex items-center gap-2"><Phone className="w-5 h-5 text-red-500" /> Contacto de Emergencia</h3>
        <div className="space-y-5">
          {field('Nombre Completo', 'emergenciaNombre')}
          <div className="grid grid-cols-2 gap-4">
            {field('Teléfono', 'emergenciaTelefono', 'tel')}
            {field('Vínculo', 'emergenciaVinculo')}
          </div>
        </div>
      </div>

      {/* Family group */}
      <div className="bg-bg-secondary rounded-[32px] p-6 shadow-sm border border-border-default mb-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-black text-lg text-gray-900 flex items-center gap-2"><Users className="w-5 h-5 text-emerald-500" /> Grupo Familiar</h3>
          {!editing && <span onClick={() => setShowAddFamiliar(true)} className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full cursor-pointer hover:bg-emerald-100 transition-colors">+ AÑADIR</span>}
        </div>
        {familiares.length === 0
          ? <p className="text-sm text-gray-400 text-center py-4">No hay familiares vinculados.</p>
          : familiares.map(f => (
            <div key={f.id} className="bg-bg-primary rounded-2xl p-4 border border-gray-100 mb-3">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-bold text-[16px] text-gray-900">{f.nombre}</p>
                  <span className="text-[12px] font-bold text-emerald-700 bg-emerald-100 py-0.5 px-2 rounded-md">{f.vinculo}</span>
                </div>
                <p className="text-[14px] text-gray-500">{f.obraSocial || '—'}</p>
              </div>
            </div>
          ))
        }
      </div>

      {/* Payment info */}
      <div className="bg-bg-secondary rounded-[32px] p-6 shadow-sm border border-border-default mb-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-black text-lg text-gray-900 flex items-center gap-2"><CreditCard className="w-5 h-5 text-brand" /> Info. de Pago</h3>
          {!editing && (
            <span
              onClick={() => { setTarjetaForm({ id: null, numero: '', titular: '', vencimiento: '', cvv: '', marca: 'VISA' }); setShowTarjeta(true) }}
              className="text-[11px] font-bold text-brand bg-brand-muted px-3 py-1.5 rounded-full cursor-pointer hover:bg-brand-light"
            >+ AÑADIR</span>
          )}
        </div>
        <div className="space-y-4">
          {tarjetas.map(t => (
            <div key={t.id} className="bg-bg-primary rounded-2xl p-4 border border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-8 rounded-md flex items-center justify-center text-[10px] text-white font-black shadow-sm ${t.marca === 'VISA' ? 'bg-[#1A1F71]' : 'bg-[#FF5F00]'}`}>{t.marca}</div>
                <div>
                  <p className="font-bold text-gray-900 text-[15px]">{t.numero}</p>
                  <p className="text-[12px] font-medium text-gray-500">Vence {t.vencimiento}</p>
                </div>
              </div>
              {editing
                ? <div className="flex gap-2">
                    <button onClick={() => { setTarjetaForm({ ...t, cvv: '' }); setShowTarjeta(true) }} className="p-2 bg-white rounded-full text-brand shadow-sm"><Edit3 className="w-4 h-4" /></button>
                    <button onClick={() => setTarjetas(prev => prev.filter(c => c.id !== t.id))} className="p-2 bg-white rounded-full text-red-600 shadow-sm"><Trash2 className="w-4 h-4" /></button>
                  </div>
                : <Check className="w-5 h-5 text-emerald-500" />
              }
            </div>
          ))}
        </div>
      </div>

      {/* Receipts */}
      <div className="bg-bg-secondary rounded-[32px] p-6 shadow-sm border border-border-default mb-6">
        <h3 className="font-black text-lg text-gray-900 mb-6 flex items-center gap-2"><Receipt className="w-5 h-5 text-gray-400" /> Comprobantes</h3>
        {comprobantes.length === 0
          ? <p className="text-sm text-gray-400 text-center py-4">No tenés comprobantes aún.</p>
          : comprobantes.map(c => (
            <div key={c.id} className="bg-white rounded-2xl p-4 border border-gray-100 flex items-center justify-between hover:bg-gray-50 cursor-pointer shadow-sm group mb-3">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center"><FileText className="w-5 h-5 text-emerald-600" /></div>
                <div>
                  <p className="font-bold text-gray-900 text-[14px] max-w-[150px] truncate">{c.concepto}</p>
                  <p className="text-[12px] text-gray-500 mt-0.5">{c.fecha}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-black text-[15px] text-gray-900">{c.monto}</span>
                <Download className="w-4 h-4 text-gray-400 group-hover:text-brand" />
              </div>
            </div>
          ))
        }
      </div>

      {!editing && (
        <button
          onClick={async () => { await authService.logout(); navigate('/') }}
          className="w-full bg-red-50 text-red-600 py-4 rounded-[20px] font-bold text-[16px] flex justify-center items-center gap-2 hover:bg-red-100 transition-colors"
        >
          <LogOut className="w-5 h-5" /> Cerrar Sesión
        </button>
      )}
      </div>{/* end max-w-lg */}

      {/* Añadir Familiar — responsive sheet/modal */}
      <PatientSheet open={showAddFamiliar} onClose={() => setShowAddFamiliar(false)} maxWidth="max-w-md">
        <div className="px-6 pt-4 pb-2 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setShowAddFamiliar(false)} className="w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50">
              <ArrowLeft className="w-5 h-5 text-gray-700" />
            </button>
            <h2 className="text-xl font-black text-gray-900">Añadir Familiar</h2>
          </div>
          <button onClick={saveNuevoFamiliar} className="text-emerald-700 font-bold px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-full hover:bg-emerald-100 text-sm">Guardar</button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-hide p-6 space-y-6 pb-8 bg-bg-primary">
          <div className="bg-white rounded-[28px] p-6 shadow-sm border border-gray-100 space-y-5">
            {[['Nombre Completo', 'nombre'], ['Vínculo', 'vinculo'], ['DNI', 'dni']].map(([lbl, nm]) => (
              <div key={nm} className="flex flex-col">
                <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">{lbl}</label>
                <input type="text" value={newFamiliar[nm]} onChange={e => setNewFamiliar(p => ({ ...p, [nm]: e.target.value }))} className="bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3.5 outline-none text-[15px] font-medium text-gray-900 focus:border-brand" />
              </div>
            ))}
          </div>
          <div className="bg-white rounded-[28px] p-6 shadow-sm border border-gray-100 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              {[['Obra Social', 'obraSocial'], ['N° Afiliado', 'numeroSocio']].map(([lbl, nm]) => (
                <div key={nm} className="flex flex-col">
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">{lbl}</label>
                  <input type="text" value={newFamiliar[nm]} onChange={e => setNewFamiliar(p => ({ ...p, [nm]: e.target.value }))} className="bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3.5 outline-none text-[15px] font-medium text-gray-900 focus:border-brand" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </PatientSheet>

      {/* Editar Tarjeta — responsive sheet/modal */}
      <PatientSheet open={showTarjeta} onClose={() => setShowTarjeta(false)} maxWidth="max-w-md">
        <div className="px-6 pt-4 pb-4 flex justify-between items-center flex-shrink-0 border-b border-gray-100">
          <button onClick={() => setShowTarjeta(false)} className="w-10 h-10 bg-white border border-gray-200 shadow-sm rounded-full flex items-center justify-center hover:bg-gray-50">
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>
          <button onClick={saveTarjeta} className="text-brand font-bold px-5 py-2 bg-brand-muted border border-brand/20 rounded-full hover:bg-brand-light">Guardar</button>
        </div>
        <div className="overflow-y-auto scrollbar-hide flex-1 p-6 pb-8 bg-bg-primary">
          <div className="bg-white rounded-[28px] p-6 shadow-sm border border-gray-100 space-y-6">
            <div className={`w-full h-40 rounded-2xl p-5 text-white flex flex-col justify-between shadow-lg ${tarjetaForm.marca === 'VISA' ? 'bg-[#1A1F71]' : 'bg-[#FF5F00]'}`}>
              <CreditCard className="w-8 h-8 opacity-80" />
              <p className="font-mono text-xl tracking-widest">{tarjetaForm.numero || '**** **** **** ****'}</p>
            </div>
            <div className="space-y-5 pt-4">
              <input type="text" name="numero" value={tarjetaForm.numero} onChange={handleTarjetaChange} placeholder="0000 0000 0000 0000" className="bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3.5 outline-none w-full font-medium focus:border-brand" />
              <input type="text" name="titular" value={tarjetaForm.titular} onChange={handleTarjetaChange} placeholder="Titular" className="bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3.5 outline-none w-full font-medium focus:border-brand" />
              <div className="grid grid-cols-2 gap-4">
                <input type="text" name="vencimiento" value={tarjetaForm.vencimiento} onChange={handleTarjetaChange} placeholder="MM/AA" className="bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3.5 outline-none w-full font-medium focus:border-brand" />
                <input type="password" name="cvv" value={tarjetaForm.cvv} onChange={handleTarjetaChange} placeholder="CVV" className="bg-bg-primary border border-gray-200 rounded-2xl px-4 py-3.5 outline-none w-full font-medium focus:border-brand" />
              </div>
            </div>
          </div>
        </div>
      </PatientSheet>
    </div>
  )
}
