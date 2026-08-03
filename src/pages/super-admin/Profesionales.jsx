import { useState, useEffect, useCallback } from 'react'
import {
  MagnifyingGlass, ShieldCheck, X, ArrowSquareOut, Warning,
  CircleNotch, Check, IdentificationCard, FileText, ShieldWarning,
  ShieldSlash, User, Pencil,
} from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { SPECIALTY_LABELS } from '../../lib/verticals'
import { toast } from '../../components/Toast'
import RefepsCheckLink from '../../components/admin/RefepsCheckLink'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(' ').filter(Boolean)
  return parts.length === 1
    ? parts[0][0].toUpperCase()
    : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function fmt(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ── Status badges ─────────────────────────────────────────────────────────────

function VerifiedBadge({ pro }) {
  if (pro.is_verified) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
        <ShieldCheck className="h-3 w-3" />
        Verificado{pro.verification_source === 'sisa' ? ' · SISA' : pro.verification_source === 'manual' ? ' · Manual' : ''}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
      Pendiente
    </span>
  )
}

function SisaBadge({ status }) {
  if (!status) return null
  const map = {
    habilitada:  { label: 'SISA: Habilitada',  cls: 'bg-emerald-50 text-emerald-700', Icon: ShieldCheck },
    suspendida:  { label: 'SISA: Suspendida',  cls: 'bg-red-50 text-red-700',         Icon: ShieldSlash },
    not_found:   { label: 'SISA: No encontrado', cls: 'bg-gray-100 text-gray-600',    Icon: ShieldWarning },
    error:       { label: 'SISA: Error',        cls: 'bg-red-50 text-red-600',         Icon: Warning },
  }
  const s = map[status] ?? map.error
  const Icon = s.Icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${s.cls}`}>
      <Icon className="h-3 w-3" /> {s.label}
    </span>
  )
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

function ProfessionalDrawer({ pro, onClose, onUpdated }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)

  // Editable fields
  const [dni, setDni] = useState('')
  const [licenseType, setLicenseType] = useState('MN')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [editingCredentials, setEditingCredentials] = useState(false)

  const [verifying, setVerifying] = useState(false)
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)

  const loadDetail = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('professional_profiles')
      .select(`
        *,
        profile:profiles!user_id(id, full_name, email, phone, dni, created_at)
      `)
      .eq('id', pro.id)
      .single()

    if (!error && data) {
      setDetail(data)
      setDni(data.profile?.dni ?? '')
      setLicenseType(data.license_type ?? 'MN')
      setLicenseNumber(data.license_number ?? '')
    }
    setLoading(false)
  }, [pro.id])

  useEffect(() => { loadDetail() }, [loadDetail])

  async function saveCredentials() {
    const updates = []

    // Save DNI to profiles
    if (dni !== (detail?.profile?.dni ?? '')) {
      const { error } = await supabase
        .from('profiles')
        .update({ dni: dni.trim() || null })
        .eq('id', detail.profile.id)
      if (error) { toast.error('Error al guardar DNI'); return }
    }

    // Save license to professional_profiles
    if (licenseType !== detail?.license_type || licenseNumber !== (detail?.license_number ?? '')) {
      const { error } = await supabase
        .from('professional_profiles')
        .update({ license_type: licenseType, license_number: licenseNumber.trim() || null })
        .eq('id', pro.id)
      if (error) { toast.error('Error al guardar matrícula'); return }
    }

    toast.success('Datos guardados')
    setEditingCredentials(false)
    await loadDetail()
    onUpdated()
  }

  async function handleSisaVerify() {
    setVerifying(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sisa-verify`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ professionalId: pro.id }),
        }
      )
      const result = await res.json()

      if (result.code === 'SISA_NOT_CONFIGURED') {
        toast.warning('Credenciales SISA no configuradas — contactar sisa@msal.gov.ar')
        return
      }
      if (result.code === 'MISSING_DNI') {
        toast.warning('Ingresá el DNI del profesional primero')
        setEditingCredentials(true)
        return
      }
      if (!res.ok) {
        toast.error(`Error SISA: ${result.error ?? 'desconocido'}`)
        return
      }

      if (result.sisaStatus === 'habilitada') {
        toast.success(`SISA: Habilitado ✓ — ${result.sisaMatricula ?? ''}`)
      } else if (result.sisaStatus === 'suspendida') {
        toast.warning('SISA: Matrícula suspendida')
      } else {
        toast.warning('SISA: Profesional no encontrado en el padrón')
      }

      await loadDetail()
      onUpdated()
    } catch {
      toast.error('Error al conectar con SISA')
    } finally {
      setVerifying(false)
    }
  }

  async function handleManualApprove() {
    setApproving(true)
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('professional_profiles')
      .update({ is_verified: true, verification_source: 'manual', verified_at: now })
      .eq('id', pro.id)

    if (error) { toast.error('Error al verificar'); setApproving(false); return }
    toast.success('Profesional verificado manualmente')
    setApproving(false)
    await loadDetail()
    onUpdated()
  }

  async function handleReject() {
    if (!rejectionReason.trim()) { toast.warning('Ingresá el motivo de rechazo'); return }
    setRejecting(true)
    const { error } = await supabase
      .from('professional_profiles')
      .update({ is_verified: false, is_active: false, rejection_reason: rejectionReason.trim() })
      .eq('id', pro.id)

    if (error) { toast.error('Error al rechazar'); setRejecting(false); return }
    toast.success('Profesional rechazado')
    setRejecting(false)
    setShowRejectForm(false)
    await loadDetail()
    onUpdated()
  }

  const d = detail
  const name = d?.profile?.full_name ?? pro.profiles?.full_name ?? '—'
  const email = d?.profile?.email ?? pro.profiles?.email ?? '—'
  const specialtyLabel = SPECIALTY_LABELS[d?.specialty ?? pro.specialty] ?? d?.specialty ?? '—'

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div className="relative z-50 w-full max-w-md bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-gray-100">
          <div className="w-10 h-10 rounded-full bg-[#e8f0eb] text-[#7CB38B] flex items-center justify-center font-semibold shrink-0">
            {getInitials(name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 truncate">{name}</p>
            <p className="text-xs text-gray-400 truncate">{email}</p>
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              <VerifiedBadge pro={d ?? pro} />
              {d?.sisa_status && <SisaBadge status={d.sisa_status} />}
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading ? (
            <div className="space-y-3">
              {[1,2,3,4].map(i => <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <>
              {/* Info rápida */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Especialidad</p>
                  <p className="font-medium text-gray-800">{specialtyLabel}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Registro</p>
                  <p className="font-medium text-gray-800">{fmt(d?.created_at)}</p>
                </div>
                {d?.profile?.phone && (
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Teléfono</p>
                    <p className="font-medium text-gray-800">{d.profile.phone}</p>
                  </div>
                )}
                {d?.submitted_at && (
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Onboarding enviado</p>
                    <p className="font-medium text-gray-800">{fmt(d.submitted_at)}</p>
                  </div>
                )}
              </div>

              {/* Credenciales — DNI + Matrícula */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <IdentificationCard className="h-4 w-4 text-gray-400" />
                    Credenciales
                  </div>
                  {!editingCredentials && (
                    <button type="button" onClick={() => setEditingCredentials(true)}
                      className="flex items-center gap-1 text-xs text-brand hover:underline">
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  {editingCredentials ? (
                    <>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">DNI</label>
                        <input type="text" value={dni} onChange={e => setDni(e.target.value)}
                          placeholder="Ej: 28123456" className="form-input text-sm" />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">Tipo</label>
                          <select value={licenseType} onChange={e => setLicenseType(e.target.value)} className="form-select text-sm">
                            <option value="MN">MN</option>
                            <option value="MP">MP</option>
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="text-xs text-gray-500 mb-1 block">Número</label>
                          <input type="text" value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)}
                            placeholder="Ej: 123456" className="form-input text-sm" />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setEditingCredentials(false)}
                          className="btn-secondary flex-1 py-1.5 text-xs">Cancelar</button>
                        <button type="button" onClick={saveCredentials}
                          className="btn-primary flex-1 py-1.5 text-xs">Guardar</button>
                      </div>
                    </>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">DNI</p>
                        <p className="font-medium text-gray-800">{d?.profile?.dni ?? <span className="text-amber-600">Sin cargar</span>}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 mb-0.5">Matrícula</p>
                        <p className="font-medium text-gray-800">
                          {d?.license_type && d?.license_number
                            ? `${d.license_type} ${d.license_number}`
                            : <span className="text-amber-600">Sin cargar</span>}
                        </p>
                      </div>
                      {d?.sisa_matricula && (
                        <div className="col-span-2">
                          <p className="text-xs text-gray-400 mb-0.5">Matrícula SISA</p>
                          <p className="font-medium text-emerald-700">{d.sisa_matricula}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Documentos subidos */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100 text-sm font-semibold text-gray-700">
                  <FileText className="h-4 w-4 text-gray-400" />
                  Documentos
                </div>
                <div className="p-4 space-y-2">
                  {[
                    { label: 'Título', url: d?.title_document_url },
                    { label: 'Matrícula', url: d?.license_document_url },
                    { label: 'DNI', url: d?.dni_document_url },
                    { label: 'Seguro de mala praxis', url: d?.malpractice_insurance_document_url },
                    { label: 'Certificado de especialista', url: d?.specialist_certificate_document_url },
                    { label: 'CUIT / Monotributo', url: d?.cuit_document_url },
                  ].map(({ label, url }) => (
                    <div key={label} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">{label}</span>
                      {url
                        ? <a href={url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-brand hover:underline text-xs font-medium">
                            Ver <ArrowSquareOut className="h-3 w-3" />
                          </a>
                        : <span className="text-xs text-gray-400">No subido</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Verificación SISA */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100 text-sm font-semibold text-gray-700">
                  <ShieldCheck className="h-4 w-4 text-gray-400" />
                  Verificación SISA
                </div>
                <div className="p-4 space-y-3">
                  {d?.sisa_status && (
                    <div className="text-xs text-gray-500 space-y-1">
                      <div className="flex items-center gap-2">
                        <SisaBadge status={d.sisa_status} />
                      </div>
                      {d.sisa_verified_at && (
                        <p>Consultado el {fmt(d.sisa_verified_at)}</p>
                      )}
                      {d.sisa_raw?.profesionales?.[0] && (
                        <div className="bg-gray-50 rounded-lg p-2 text-[11px] font-mono text-gray-600 mt-1">
                          {JSON.stringify(d.sisa_raw.profesionales[0], null, 2)
                            .split('\n').slice(0, 8).join('\n')}
                        </div>
                      )}
                    </div>
                  )}
                  <button type="button" onClick={handleSisaVerify} disabled={verifying}
                    className="w-full flex items-center justify-center gap-2 text-sm font-semibold py-2.5 px-4 rounded-xl bg-brand/10 text-brand hover:bg-brand/20 transition-colors disabled:opacity-60">
                    {verifying
                      ? <><CircleNotch className="h-4 w-4 animate-spin" /> Consultando SISA…</>
                      : <><ShieldCheck className="h-4 w-4" /> Verificar vía SISA</>}
                  </button>
                  <p className="text-[11px] text-gray-400 text-center">
                    Requiere DNI del profesional + credenciales SISA en Supabase secrets
                  </p>

                  {/* Manual-check companion — REFEPS doesn't support pre-filled URLs */}
                  <div className="pt-3 mt-1 border-t border-gray-100">
                    <RefepsCheckLink fullName={name} dni={d?.profile?.dni} />
                  </div>
                </div>
              </div>

              {/* Rechazo */}
              {d?.rejection_reason && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-semibold text-red-700 mb-1">Motivo de rechazo</p>
                  <p className="text-sm text-red-700">{d.rejection_reason}</p>
                </div>
              )}

              {/* Reject form */}
              {showRejectForm && (
                <div className="space-y-2">
                  <textarea
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    placeholder="Motivo del rechazo (visible solo para el admin)…"
                    rows={3}
                    className="form-textarea resize-none text-sm w-full"
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setShowRejectForm(false)}
                      className="btn-secondary flex-1 py-2 text-sm">Cancelar</button>
                    <button type="button" onClick={handleReject} disabled={rejecting}
                      className="btn-danger flex-1 py-2 text-sm flex items-center justify-center gap-1">
                      {rejecting ? <CircleNotch className="h-4 w-4 animate-spin" /> : null}
                      Confirmar rechazo
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        {!loading && (
          <div className="p-4 border-t border-gray-100 space-y-2">
            {!d?.is_verified ? (
              <button type="button" onClick={handleManualApprove} disabled={approving}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors disabled:opacity-60">
                {approving
                  ? <CircleNotch className="h-4 w-4 animate-spin" />
                  : <Check className="h-4 w-4" />}
                Verificar manualmente
              </button>
            ) : (
              <div className="flex items-center justify-center gap-2 text-sm text-emerald-700">
                <ShieldCheck className="h-4 w-4" />
                Profesional verificado el {fmt(d?.verified_at ?? d?.updated_at)}
              </div>
            )}
            {!showRejectForm && (
              <button type="button" onClick={() => setShowRejectForm(true)}
                className="w-full py-2 rounded-xl border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors">
                Rechazar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SuperAdminProfesionales() {
  const [professionals, setProfessionals] = useState([])
  const [consultationMap, setConsultationMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('todos')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)

  async function fetchData() {
    setLoading(true)
    try {
      const [profResult, consultResult] = await Promise.all([
        supabase
          .from('professional_profiles')
          .select('id, specialty, is_verified, verification_source, sisa_status, mp_connected, mp_account_label, average_rating, total_reviews, created_at, profiles!user_id(id, full_name, email, created_at, utm_source)')
          .order('created_at', { ascending: false }),
        supabase.from('consultations').select('professional_id'),
      ])

      if (profResult.error) throw profResult.error
      setProfessionals(profResult.data ?? [])

      const map = {}
      for (const row of consultResult.data ?? []) {
        if (!row.professional_id) continue
        map[row.professional_id] = (map[row.professional_id] || 0) + 1
      }
      setConsultationMap(map)
    } catch {
      toast.error('Error al cargar los profesionales')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  const filtered = professionals.filter(p => {
    if (filter === 'verificados' && !p.is_verified) return false
    if (filter === 'pendientes' && p.is_verified) return false
    if (filter === 'sin-mp' && p.mp_connected) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const name = p.profiles?.full_name?.toLowerCase() ?? ''
      const email = p.profiles?.email?.toLowerCase() ?? ''
      const specialty = (SPECIALTY_LABELS[p.specialty] ?? p.specialty ?? '').toLowerCase()
      if (!name.includes(q) && !email.includes(q) && !specialty.includes(q)) return false
    }
    return true
  })

  const pills = [
    { key: 'todos', label: 'Todos' },
    { key: 'verificados', label: 'Verificados' },
    { key: 'pendientes', label: 'Pendientes' },
    { key: 'sin-mp', label: 'Sin MP' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profesionales</h1>
        <p className="text-sm text-gray-500 mt-1">
          {loading ? 'Cargando…' : `${professionals.length} profesionales registrados`}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {pills.map(pill => (
            <button key={pill.key} onClick={() => setFilter(pill.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === pill.key
                  ? 'bg-[#7CB38B] text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-[#7CB38B] hover:text-[#7CB38B]'
              }`}>
              {pill.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Buscar profesional…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="form-input pl-9 w-full text-sm" />
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="table-header">Profesional</th>
                <th className="table-header">Especialidad</th>
                <th className="table-header">Estado</th>
                <th className="table-header">SISA</th>
                <th className="table-header">MP</th>
                <th className="table-header">Rating</th>
                <th className="table-header">Consultas</th>
                <th className="table-header">Registro</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="table-row">
                    <td className="table-cell">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse shrink-0" />
                        <div className="space-y-1.5">
                          <div className="h-3 w-32 bg-gray-200 rounded animate-pulse" />
                          <div className="h-2.5 w-24 bg-gray-100 rounded animate-pulse" />
                        </div>
                      </div>
                    </td>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="table-cell">
                        <div className="h-3 w-16 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-gray-400">
                      <User size={40} weight="thin" />
                      <p className="text-sm">No se encontraron profesionales</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map(pro => {
                  const name = pro.profiles?.full_name ?? '—'
                  const email = pro.profiles?.email ?? '—'
                  const specialtyLabel = SPECIALTY_LABELS[pro.specialty] ?? pro.specialty ?? '—'
                  const consultCount = consultationMap[pro.profiles?.id] ?? 0
                  const isSelected = selected?.id === pro.id

                  return (
                    <tr key={pro.id}
                      onClick={() => setSelected(isSelected ? null : pro)}
                      className={`table-row cursor-pointer transition-colors ${isSelected ? 'bg-brand/5' : 'hover:bg-gray-50'}`}>
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#e8f0eb] text-[#7CB38B] flex items-center justify-center text-xs font-semibold shrink-0">
                            {getInitials(name)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                            <p className="text-xs text-gray-400 truncate">{email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="table-cell">
                        <span className="text-sm text-gray-700">{specialtyLabel}</span>
                      </td>
                      <td className="table-cell">
                        <VerifiedBadge pro={pro} />
                      </td>
                      <td className="table-cell">
                        {pro.sisa_status
                          ? <SisaBadge status={pro.sisa_status} />
                          : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="table-cell">
                        {pro.mp_connected
                          ? (
                            <div className="max-w-[160px]">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">Conectado</span>
                              {pro.mp_account_label && (
                                <p className="text-[11px] text-gray-400 truncate mt-0.5" title={pro.mp_account_label}>
                                  {pro.mp_account_label}
                                </p>
                              )}
                            </div>
                          )
                          : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600">Sin conectar</span>}
                      </td>
                      <td className="table-cell">
                        {pro.average_rating > 0
                          ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                              ★ {Number(pro.average_rating).toFixed(1)}
                            </span>
                          : <span className="text-gray-400 text-sm">—</span>}
                      </td>
                      <td className="table-cell">
                        <span className="text-sm text-gray-700">{consultCount}</span>
                      </td>
                      <td className="table-cell">
                        <span className="text-sm text-gray-500">{fmt(pro.created_at)}</span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <ProfessionalDrawer
          pro={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => {
            fetchData()
            // Refresh selected pro in the list after update
          }}
        />
      )}
    </div>
  )
}
