import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  MagnifyingGlass, ShieldCheck, X, ArrowSquareOut, Warning,
  CircleNotch, Check, IdentificationCard, FileText, ShieldWarning,
  ShieldSlash, User, Pencil, UploadSimple, ClockCounterClockwise, XCircle,
  Clock, Trash,
} from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { useEspecialidades } from '../../hooks/useEspecialidades'
import { toast } from '../../components/Toast'
import RefepsCheckLink from '../../components/admin/RefepsCheckLink'
import SignedDocLink from '../../components/SignedDocLink'
import { professionalService } from '../../services/professionalService'
import { paymentsService } from '../../services/paymentsService'
import { adminService } from '../../services/adminService'
import { formatSettlementPlazo } from '../../lib/format'
import { useBulkSelection } from '../../hooks/useBulkSelection'
import BulkActionBar from '../../components/super-admin/BulkActionBar'
import ConfirmDeleteDialog from '../../components/super-admin/ConfirmDeleteDialog'

// Documentos que puede gestionar el super admin desde el drawer (A6) — mismo
// nombre de archivo que usa Onboarding.jsx al subir, para que un reemplazo
// caiga en el mismo lugar del bucket que el original.
const DOC_FIELDS = [
  { label: 'Título',                        urlKey: 'title_document_url',                     camelKey: 'titleDocumentUrl',                     fileName: 'titulo' },
  { label: 'Matrícula',                     urlKey: 'license_document_url',                   camelKey: 'licenseDocumentUrl',                   fileName: 'matricula' },
  { label: 'DNI',                           urlKey: 'dni_document_url',                       camelKey: 'dniDocumentUrl',                       fileName: 'dni' },
  { label: 'Seguro de mala praxis',         urlKey: 'malpractice_insurance_document_url',     camelKey: 'malpracticeInsuranceDocumentUrl',      fileName: 'seguro_mala_praxis' },
  { label: 'Certificado de especialista',   urlKey: 'specialist_certificate_document_url',    camelKey: 'specialistCertificateDocumentUrl',     fileName: 'certificado_especialista' },
  { label: 'CUIT / Monotributo',            urlKey: 'cuit_document_url',                      camelKey: 'cuitDocumentUrl',                      fileName: 'cuit' },
]

function fmtDateTime(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const REVIEW_ACTION_LABELS = {
  approved:            { label: 'Verificado',        cls: 'text-emerald-700' },
  needs_revision:      { label: 'Pidió revisión',    cls: 'text-amber-700' },
  rejected_permanent:  { label: 'Rechazo permanente', cls: 'text-red-700' },
}

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

// Antes esto era binario (Verificado / Pendiente): un profesional rechazado
// seguía mostrando "Pendiente" en la tabla, indistinguible de uno que
// todavía no fue revisado — el CEO lo señaló explícito ("actualizar tabla
// cuando se rechaza"). Ahora refleja las 4 combinaciones reales de
// is_verified + rejected_at + rejection_type.
function VerifiedBadge({ pro }) {
  if (pro.is_verified) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
        <ShieldCheck className="h-3 w-3" />
        Verificado{pro.verification_source === 'sisa' ? ' · SISA' : pro.verification_source === 'manual' ? ' · Manual' : ''}
      </span>
    )
  }
  if (pro.rejected_at && pro.rejection_type === 'permanente') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">
        <XCircle className="h-3 w-3" />
        Rechazado
      </span>
    )
  }
  if (pro.rejected_at) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-700">
        <Warning className="h-3 w-3" />
        Necesita revisión
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
  const { porSlug } = useEspecialidades()
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)

  // Editable fields
  const [dni, setDni] = useState('')
  const [licenseType, setLicenseType] = useState('MN')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [editingCredentials, setEditingCredentials] = useState(false)

  const [verifying, setVerifying] = useState(false)
  const [approving, setApproving] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  // null | 'revision' | 'permanente' — cuál de las dos acciones de rechazo
  // está mostrando el formulario ahora mismo.
  const [showReviewForm, setShowReviewForm] = useState(null)
  const [history, setHistory] = useState([])
  // B3 — plazo de acreditación de MP para este profesional. null = sin cargar
  // todavía; { count: 0, ... } = cargado pero sin cobros con el dato.
  const [settlementPlazo, setSettlementPlazo] = useState(null)

  // A6 — subida/reemplazo de documentos por el super admin.
  const fileInputRef = useRef(null)
  const pendingFieldRef = useRef(null)
  const [uploadingDocKey, setUploadingDocKey] = useState(null)

  const loadDetail = useCallback(async () => {
    setLoading(true)
    const [{ data, error }, historyRows] = await Promise.all([
      supabase
        .from('professional_profiles')
        .select(`
          *,
          profile:profiles!user_id(id, full_name, email, phone, dni, created_at)
        `)
        .eq('id', pro.id)
        .single(),
      professionalService.getVerificationHistory(pro.id).catch(() => []),
    ])

    if (!error && data) {
      setDetail(data)
      if (data.profile?.id) {
        // payments.professional_id es profiles.id, no professional_profiles.id
        // (que es `pro.id`) — por eso va con el id anidado.
        paymentsService.getSettlementPlazo(data.profile.id).then(({ data: plazo }) => setSettlementPlazo(plazo))
      }
      setDni(data.profile?.dni ?? '')
      setLicenseType(data.license_type ?? 'MN')
      setLicenseNumber(data.license_number ?? '')
    }
    setHistory(historyRows)
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
    try {
      const { data: { user } } = await supabase.auth.getUser()
      await professionalService.approve(pro.id, user?.id ?? null)
      toast.success('Profesional verificado manualmente')
      await loadDetail()
      onUpdated()
    } catch {
      toast.error('Error al verificar')
    } finally {
      setApproving(false)
    }
  }

  // Reemplaza al viejo `handleReject` único: ahora son dos acciones
  // distintas (A4) — "necesita revisión" (el profesional puede corregir y
  // reenviar) y "rechazo permanente" (no puede reenviar más). El motivo es
  // obligatorio en las dos, igual que antes.
  async function handleReview(type) {
    if (!rejectionReason.trim()) { toast.warning('Ingresá el motivo'); return }
    setReviewing(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (type === 'revision') {
        await professionalService.requestRevision(pro.id, user?.id ?? null, rejectionReason.trim())
        toast.success('Se le pidió revisión al profesional')
      } else {
        await professionalService.rejectPermanently(pro.id, user?.id ?? null, rejectionReason.trim())
        toast.success('Profesional rechazado permanentemente')
      }
      setShowReviewForm(null)
      setRejectionReason('')
      await loadDetail()
      onUpdated()
    } catch {
      toast.error('Error al guardar la revisión')
    } finally {
      setReviewing(false)
    }
  }

  // A6 — el super admin sube o reemplaza un documento en nombre del
  // profesional. Reusa `professionalService.uploadDocument` (mismo código
  // que Onboarding.jsx) — sólo cambiaron las policies del bucket (097) para
  // permitirle a `super_admin` escribir en una carpeta que no es la suya.
  function triggerDocUpload(field) {
    pendingFieldRef.current = field
    fileInputRef.current?.click()
  }

  async function handleDocFileSelected(e) {
    const file = e.target.files?.[0]
    const field = pendingFieldRef.current
    e.target.value = ''
    if (!file || !field || !detail?.profile?.id) return

    setUploadingDocKey(field.urlKey)
    try {
      const url = await professionalService.uploadDocument(detail.profile.id, file, 'professional-docs', field.fileName)
      await professionalService.upsert(detail.profile.id, { [field.camelKey]: url })
      toast.success(`${field.label}: documento actualizado`)
      await loadDetail()
      onUpdated()
    } catch {
      toast.error(`No pudimos subir "${field.label}"`)
    } finally {
      setUploadingDocKey(null)
    }
  }

  const d = detail
  const name = d?.profile?.full_name ?? pro.profiles?.full_name ?? '—'
  const email = d?.profile?.email ?? pro.profiles?.email ?? '—'
  const specialtyLabel = porSlug[d?.specialty ?? pro.specialty] ?? d?.specialty ?? '—'

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

              {/* Mercado Pago — conexión + plazo de acreditación (B3) */}
              <div className="rounded-xl border border-gray-200 px-4 py-3 flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${d?.mp_connected ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <Clock className={`h-4 w-4 ${d?.mp_connected ? 'text-emerald-600' : 'text-red-500'}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">
                    Mercado Pago: {d?.mp_connected ? 'Conectado' : 'Sin conectar'}
                    {d?.mp_account_label && <span className="text-gray-400 font-normal"> · {d.mp_account_label}</span>}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {settlementPlazo?.count
                      ? `Retira su plata a los ${formatSettlementPlazo(settlementPlazo)} de cada cobro.`
                      : 'Plazo de acreditación: sin cobros liquidados todavía.'}
                  </p>
                </div>
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

              {/* Documentos subidos — A6: el super admin puede subir/reemplazar
                  cada uno acá mismo, no sólo verlos. Un solo <input type=file>
                  oculto, reusado por todas las filas vía triggerDocUpload(). */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={handleDocFileSelected}
              />
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100 text-sm font-semibold text-gray-700">
                  <FileText className="h-4 w-4 text-gray-400" />
                  Documentos
                </div>
                <div className="p-4 space-y-2">
                  {DOC_FIELDS.map(field => {
                    const url = d?.[field.urlKey]
                    const isUploading = uploadingDocKey === field.urlKey
                    return (
                      <div key={field.urlKey} className="flex items-center justify-between text-sm gap-2">
                        <span className="text-gray-600">{field.label}</span>
                        <div className="flex items-center gap-3 shrink-0">
                          {url
                            ? <SignedDocLink url={url}
                                className="flex items-center gap-1 text-brand hover:underline text-xs font-medium">
                                Ver <ArrowSquareOut className="h-3 w-3" />
                              </SignedDocLink>
                            : <span className="text-xs text-gray-400">No subido</span>}
                          <button type="button" onClick={() => triggerDocUpload(field)} disabled={isUploading}
                            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-brand transition-colors disabled:opacity-60">
                            {isUploading
                              ? <CircleNotch className="h-3 w-3 animate-spin" />
                              : <UploadSimple className="h-3 w-3" />}
                            {url ? 'Reemplazar' : 'Subir'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
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

              {/* Estado de rechazo actual — A4: el motivo siempre visible, y
                  distingue si el profesional puede reenviar o no (el
                  profesional ve exactamente lo mismo en su dashboard). */}
              {d?.rejection_reason && (
                <div className={`rounded-xl border p-3 ${d.rejection_type === 'permanente' ? 'border-red-200 bg-red-50' : 'border-orange-200 bg-orange-50'}`}>
                  <p className={`text-xs font-semibold mb-1 ${d.rejection_type === 'permanente' ? 'text-red-700' : 'text-orange-700'}`}>
                    {d.rejection_type === 'permanente' ? 'Rechazado permanentemente — motivo' : 'Necesita revisión — motivo'}
                  </p>
                  <p className={`text-sm ${d.rejection_type === 'permanente' ? 'text-red-700' : 'text-orange-700'}`}>{d.rejection_reason}</p>
                  {d.rejection_type === 'permanente' && (
                    <p className="text-xs text-red-600 mt-1.5">El profesional no puede reenviar su perfil.</p>
                  )}
                </div>
              )}

              {/* Review form — un solo formulario, dos acciones (A4). El
                  motivo es obligatorio para las dos. */}
              {showReviewForm && (
                <div className="space-y-2">
                  <textarea
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    placeholder={showReviewForm === 'permanente'
                      ? 'Motivo del rechazo permanente (el profesional lo va a ver)…'
                      : 'Qué le falta corregir (el profesional lo va a ver)…'}
                    rows={3}
                    className="form-textarea resize-none text-sm w-full"
                  />
                  {showReviewForm === 'permanente' && (
                    <p className="text-xs text-red-600">Esta acción es definitiva: el profesional no va a poder reenviar su perfil.</p>
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setShowReviewForm(null); setRejectionReason('') }}
                      className="btn-secondary flex-1 py-2 text-sm">Cancelar</button>
                    <button type="button" onClick={() => handleReview(showReviewForm)} disabled={reviewing}
                      className="btn-danger flex-1 py-2 text-sm flex items-center justify-center gap-1">
                      {reviewing ? <CircleNotch className="h-4 w-4 animate-spin" /> : null}
                      {showReviewForm === 'permanente' ? 'Confirmar rechazo permanente' : 'Confirmar — pedir revisión'}
                    </button>
                  </div>
                </div>
              )}

              {/* A5 — quién verificó, cuándo, y el historial completo (puede
                  pasar varias veces sobre el mismo profesional). */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100 text-sm font-semibold text-gray-700">
                  <ClockCounterClockwise className="h-4 w-4 text-gray-400" />
                  Historial de verificación
                </div>
                <div className="p-4">
                  {history.length === 0 ? (
                    <p className="text-xs text-gray-400">Todavía no hay ninguna revisión registrada.</p>
                  ) : (
                    <ul className="space-y-3">
                      {history.map(h => {
                        const info = REVIEW_ACTION_LABELS[h.action] ?? { label: h.action, cls: 'text-gray-700' }
                        return (
                          <li key={h.id} className="text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className={`font-semibold ${info.cls}`}>{info.label}</span>
                              <span className="text-gray-400">{fmtDateTime(h.createdAt)}</span>
                            </div>
                            <p className="text-gray-500 mt-0.5">
                              Por {h.reviewer?.fullName ?? h.reviewer?.full_name ?? 'Admin'}
                              {(h.reviewer?.email) ? ` · ${h.reviewer.email}` : ''}
                            </p>
                            {h.reason && <p className="text-gray-600 mt-0.5 bg-gray-50 rounded-lg p-2">{h.reason}</p>}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
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
                Verificado el {fmt(d?.verified_at ?? d?.updated_at)}
              </div>
            )}
            {!showReviewForm && (
              <div className="flex gap-2">
                <button type="button" onClick={() => { setShowReviewForm('revision'); setRejectionReason('') }}
                  className="flex-1 py-2 rounded-xl border border-orange-200 text-orange-700 text-sm font-medium hover:bg-orange-50 transition-colors">
                  Pedir revisión
                </button>
                <button type="button" onClick={() => { setShowReviewForm('permanente'); setRejectionReason('') }}
                  className="flex-1 py-2 rounded-xl border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors">
                  Rechazo permanente
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SuperAdminProfesionales() {
  const { porSlug } = useEspecialidades()
  const [professionals, setProfessionals] = useState([])
  const [consultationMap, setConsultationMap] = useState({})
  const [loading, setLoading] = useState(true)
  // El nav "Pendientes verificación" linkea acá con ?filter=pendientes en vez
  // de duplicar esta página — así el filtro y los datos son siempre los mismos.
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState(searchParams.get('filter') || 'todos')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)

  async function fetchData() {
    setLoading(true)
    try {
      const [profResult, consultResult] = await Promise.all([
        supabase
          .from('professional_profiles')
          .select('id, specialty, is_verified, verification_source, sisa_status, mp_connected, mp_account_label, average_rating, total_reviews, created_at, rejected_at, rejection_type, profiles!user_id(id, full_name, email, created_at, utm_source)')
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
    // "Pendientes" ahora excluye a los ya rechazados (revisión o permanente)
    // — antes de la 097 no había forma de distinguirlos y quedaban mezclados
    // acá, que es exactamente lo que el CEO pidió arreglar.
    if (filter === 'pendientes' && (p.is_verified || p.rejected_at)) return false
    if (filter === 'rechazados' && !p.rejected_at) return false
    if (filter === 'sin-mp' && p.mp_connected) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const name = p.profiles?.full_name?.toLowerCase() ?? ''
      const email = p.profiles?.email?.toLowerCase() ?? ''
      const specialty = (porSlug[p.specialty] ?? p.specialty ?? '').toLowerCase()
      if (!name.includes(q) && !email.includes(q) && !specialty.includes(q)) return false
    }
    return true
  })

  const pills = [
    { key: 'todos', label: 'Todos' },
    { key: 'verificados', label: 'Verificados' },
    { key: 'pendientes', label: 'Pendientes' },
    { key: 'rechazados', label: 'Rechazados' },
    { key: 'sin-mp', label: 'Sin MP' },
  ]

  // El id borrable es el del profile (profiles.id), no el de professional_profiles —
  // deleteProfiles cascadea profiles → professional_profiles/consultas/etc.
  const selection = useBulkSelection(filtered.map(p => p.profiles?.id).filter(Boolean))
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const deleteSelected = async (ids) => {
    setDeleting(true)
    try {
      await adminService.deleteProfiles(ids)
      setProfessionals(prev => prev.filter(p => !ids.includes(p.profiles?.id)))
      selection.clear()
      setConfirmOpen(false)
      if (selected && ids.includes(selected.profiles?.id)) setSelected(null)
      toast.success(`${ids.length} profesional${ids.length === 1 ? '' : 'es'} eliminado${ids.length === 1 ? '' : 's'}`)
    } catch (err) {
      toast.error(err.message || 'No se pudo eliminar')
    } finally {
      setDeleting(false)
    }
  }

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
                <th className="table-header w-8">
                  <input type="checkbox" checked={selection.isAllSelected} onChange={selection.toggleAll} onClick={e => e.stopPropagation()} className="rounded border-border-default" />
                </th>
                <th className="table-header">Profesional</th>
                <th className="table-header">Especialidad</th>
                <th className="table-header">Estado</th>
                <th className="table-header">SISA</th>
                <th className="table-header">MP</th>
                <th className="table-header">Rating</th>
                <th className="table-header">Consultas</th>
                <th className="table-header">Registro</th>
                <th className="table-header w-8" />
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
                  const specialtyLabel = porSlug[pro.specialty] ?? pro.specialty ?? '—'
                  const consultCount = consultationMap[pro.profiles?.id] ?? 0
                  const isSelected = selected?.id === pro.id

                  const profileId = pro.profiles?.id
                  return (
                    <tr key={pro.id}
                      onClick={() => setSelected(isSelected ? null : pro)}
                      className={`table-row cursor-pointer transition-colors ${isSelected ? 'bg-brand/5' : 'hover:bg-gray-50'}`}>
                      <td className="table-cell" onClick={e => e.stopPropagation()}>
                        {profileId && (
                          <input type="checkbox" checked={selection.isSelected(profileId)} onChange={() => selection.toggle(profileId)} className="rounded border-border-default" />
                        )}
                      </td>
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
                      <td className="table-cell" onClick={e => e.stopPropagation()}>
                        {profileId && (
                          <button onClick={() => { selection.toggle(profileId); setConfirmOpen(true) }} className="p-1 text-text-tertiary hover:text-danger transition-colors" title="Eliminar">
                            <Trash className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <BulkActionBar count={selection.count} onDelete={() => setConfirmOpen(true)} onClear={selection.clear} />
      <ConfirmDeleteDialog
        open={confirmOpen}
        title={`Eliminar ${selection.count} profesional${selection.count === 1 ? '' : 'es'}`}
        message="Esta acción no se puede deshacer. Si tiene historia clínica escrita, la ley 26.529 impide borrarlo."
        loading={deleting}
        onConfirm={() => deleteSelected(selection.selectedIds)}
        onCancel={() => setConfirmOpen(false)}
      />

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
