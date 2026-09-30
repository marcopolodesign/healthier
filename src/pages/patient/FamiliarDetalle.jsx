import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, CalendarPlus, Lightning, ClipboardText, UploadSimple, Key, CircleNotch,
  FileText, VideoCamera, MapPin, Copy,
} from '@phosphor-icons/react'
import { familyService } from '../../services/familyService'
import { consultationsService } from '../../services/consultationsService'
import { diagnosticReportService } from '../../services/diagnosticReportService'
import SignedDocLink from '../../components/SignedDocLink'
import { toast } from '../../components/Toast'

function edad(birthDate) {
  if (!birthDate) return null
  const n = new Date(`${birthDate}T12:00:00`)
  const hoy = new Date()
  let e = hoy.getFullYear() - n.getFullYear()
  if (hoy < new Date(hoy.getFullYear(), n.getMonth(), n.getDate())) e--
  return e
}

const fecha = iso => (iso
  ? new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' })
  : '—')

/**
 * La tarjeta de un familiar (grupo familiar, migración 181).
 *
 * El familiar es un paciente con perfil e historia clínica propios, sin
 * contraseña. Desde acá el titular le reserva, le sube estudios, lee su HC y le
 * genera un código para que entre solo (un adulto mayor, por ejemplo).
 */
export default function FamiliarDetalle({ profile }) {
  const { id: familiarId } = useParams()
  const navigate = useNavigate()
  const archivoRef = useRef(null)

  const [vinculo, setVinculo] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [consultas, setConsultas] = useState([])
  const [estudios, setEstudios] = useState([])
  const [subiendo, setSubiendo] = useState(false)
  const [pin, setPin] = useState(null)
  const [generando, setGenerando] = useState(false)

  const cargarEstudios = () =>
    diagnosticReportService.getByPatient(familiarId).then(setEstudios).catch(() => {})

  useEffect(() => {
    if (!profile?.id || !familiarId) return
    setCargando(true)
    Promise.all([
      familyService.getFamiliar(profile.id, familiarId).then(setVinculo),
      consultationsService.getByPatient(familiarId, { conFamiliares: false }).then(setConsultas).catch(() => {}),
      cargarEstudios(),
    ])
      .catch(() => toast.error('No pudimos cargar a tu familiar.'))
      .finally(() => setCargando(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, familiarId])

  const subirEstudio = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || subiendo) return
    setSubiendo(true)
    try {
      const documentUrl = await diagnosticReportService.uploadDocumento(familiarId, file)
      await diagnosticReportService.create({
        patientId: familiarId,
        reportDate: new Date().toISOString().slice(0, 10),
        parameters: [],
        documentUrl,
        studyType: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Estudio',
      })
      toast.success('Estudio subido')
      await cargarEstudios()
    } catch (err) {
      toast.error(`No pudimos subir el estudio.${err?.message ? ` (${err.message})` : ''}`)
    } finally {
      setSubiendo(false)
    }
  }

  const generarPin = async () => {
    if (generando) return
    setGenerando(true)
    try {
      setPin(await familyService.generarPin(familiarId))
    } catch (err) {
      toast.error(err?.message || 'No pudimos generar el código.')
    } finally {
      setGenerando(false)
    }
  }

  const copiarPin = async () => {
    try {
      await navigator.clipboard.writeText(pin.pin)
      toast.success('Código copiado')
    } catch { /* sin permiso de portapapeles: el código igual está en pantalla */ }
  }

  if (cargando) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-bg-primary">
        <CircleNotch className="w-8 h-8 text-brand animate-spin" />
      </div>
    )
  }

  if (!vinculo) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-bg-primary px-6 text-center">
        <p className="text-[15px] text-text-secondary">Este familiar no está en tu grupo.</p>
        <Link to="/paciente/perfil" className="btn-primary px-6 py-3 rounded-full">Volver a mi perfil</Link>
      </div>
    )
  }

  const f = vinculo.familiar ?? {}
  const nombre = f.fullName || vinculo.fullName
  const anios = edad(f.birthDate)
  const acciones = [
    { icono: CalendarPlus, titulo: 'Reservar turno', texto: 'Con el profesional que elijas', a: `/paciente/reservar?para=${familiarId}` },
    { icono: Lightning, titulo: 'Consulta inmediata', texto: 'Clínica médica, ahora', a: `/paciente/ondemand/clinica?para=${familiarId}` },
    { icono: ClipboardText, titulo: 'Historia clínica', texto: 'Consultas, diagnósticos y recetas', a: `/paciente/historia-clinica?de=${familiarId}` },
  ]

  return (
    <div className="absolute inset-0 overflow-y-auto bg-bg-primary">
      <div className="sticky top-0 z-20 bg-bg-primary/95 backdrop-blur-sm border-b border-border-default">
        <div className="flex items-center gap-3 px-4 py-4 max-w-lg mx-auto">
          <button
            onClick={() => navigate('/paciente/perfil')}
            className="w-9 h-9 rounded-full bg-bg-secondary border border-border-default flex items-center justify-center flex-shrink-0 hover:bg-gray-100"
          >
            <ArrowLeft className="w-5 h-5 text-text-primary" />
          </button>
          <h2 className="flex-1 text-center font-serif text-lg text-text-primary truncate">Grupo familiar</h2>
          <div className="w-9" />
        </div>
      </div>

      <div className="px-4 py-6 pb-32 max-w-lg mx-auto space-y-5">
        <div>
          <h1 className="font-serif font-light text-3xl text-text-primary leading-tight">{nombre}</h1>
          <p className="text-[14px] text-text-secondary mt-1">
            {[vinculo.relationship, anios != null ? `${anios} años` : null, f.dni ? `DNI ${f.dni}` : null].filter(Boolean).join(' · ') || 'Familiar'}
          </p>
          <p className="text-[12px] text-text-tertiary mt-2">
            Tiene su propia historia clínica. Lo que reserves o subas acá queda a su nombre; el cobro sale de tus tarjetas.
          </p>
        </div>

        <div className="space-y-2.5">
          {acciones.map(a => (
            <Link
              key={a.titulo}
              to={a.a}
              className="flex items-center gap-3 rounded-2xl border border-border-default bg-white px-4 py-4 hover:border-brand/50 transition-colors"
            >
              <span className="w-10 h-10 rounded-full bg-brand-muted text-brand flex items-center justify-center flex-shrink-0">
                <a.icono className="w-5 h-5" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-semibold text-text-primary">{a.titulo}</span>
                <span className="block text-[12px] text-text-tertiary">{a.texto}</span>
              </span>
            </Link>
          ))}
        </div>

        {/* Estudios */}
        <section className="rounded-2xl border border-border-default bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[15px] font-semibold text-text-primary">Estudios y documentos</h3>
            <button
              onClick={() => archivoRef.current?.click()}
              disabled={subiendo}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-brand bg-brand-muted px-3 py-1.5 rounded-full disabled:opacity-50"
            >
              {subiendo ? <CircleNotch className="w-4 h-4 animate-spin" /> : <UploadSimple className="w-4 h-4" />}
              {subiendo ? 'Subiendo…' : 'Subir'}
            </button>
            <input ref={archivoRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={subirEstudio} />
          </div>
          {estudios.length === 0
            ? <p className="text-[13px] text-text-tertiary">Todavía no hay estudios. Subí un PDF o una foto y lo va a ver el profesional que lo atienda.</p>
            : (
              <ul className="divide-y divide-border-default">
                {estudios.map(r => (
                  <li key={r.id} className="py-2.5 flex items-center gap-3">
                    <FileText className="w-5 h-5 text-text-tertiary flex-shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] text-text-primary truncate">{r.studyType || 'Estudio'}</span>
                      <span className="block text-[12px] text-text-tertiary">{fecha(r.reportDate)}</span>
                    </span>
                    {r.documentUrl && (
                      <SignedDocLink bucket="patient-docs" url={r.documentUrl} className="text-[12px] font-semibold text-brand">Ver</SignedDocLink>
                    )}
                  </li>
                ))}
              </ul>
            )}
        </section>

        {/* Consultas */}
        <section className="rounded-2xl border border-border-default bg-white p-4">
          <h3 className="text-[15px] font-semibold text-text-primary mb-3">Consultas</h3>
          {consultas.length === 0
            ? <p className="text-[13px] text-text-tertiary">Sin consultas todavía.</p>
            : (
              <ul className="divide-y divide-border-default">
                {consultas.slice(0, 10).map(c => (
                  <li key={c.id} className="py-2.5 flex items-center gap-3">
                    {c.modality === 'video' ? <VideoCamera className="w-5 h-5 text-brand flex-shrink-0" /> : <MapPin className="w-5 h-5 text-emerald-600 flex-shrink-0" />}
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] text-text-primary truncate">{c.professional?.fullName || 'Profesional'}</span>
                      <span className="block text-[12px] text-text-tertiary">{fecha(c.scheduledAt)}</span>
                    </span>
                    <Link to={`/paciente/turno-confirmado/${c.id}`} className="text-[12px] font-semibold text-brand">Ver</Link>
                  </li>
                ))}
              </ul>
            )}
        </section>

        {/* Código de acceso */}
        <section className="rounded-2xl border border-border-default bg-white p-4">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-full bg-brand-muted text-brand flex items-center justify-center flex-shrink-0">
              <Key className="w-5 h-5" />
            </span>
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-semibold text-text-primary">Que entre por su cuenta</h3>
              <p className="text-[13px] text-text-tertiary mt-0.5">
                No tiene contraseña. Generale un código de un solo uso: lo escribe en "Entrar con código familiar" y vence a los 15 minutos.
              </p>
            </div>
          </div>
          {pin ? (
            <div className="mt-4 rounded-2xl bg-bg-primary border border-border-default p-4 text-center">
              <p className="font-mono text-[34px] tracking-[0.3em] text-text-primary">{pin.pin}</p>
              <p className="text-[12px] text-text-tertiary mt-1">
                Vence a las {new Date(pin.expiraAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })} · entra en {window.location.host}/acceso-familiar
              </p>
              <div className="flex gap-2 justify-center mt-3">
                <button onClick={copiarPin} className="flex items-center gap-1.5 text-[12px] font-semibold text-brand bg-brand-muted px-3 py-1.5 rounded-full">
                  <Copy className="w-4 h-4" /> Copiar
                </button>
                <button onClick={generarPin} disabled={generando} className="text-[12px] font-semibold text-text-secondary px-3 py-1.5 rounded-full border border-border-default">
                  Generar otro
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={generarPin}
              disabled={generando}
              className="mt-4 w-full py-3 rounded-full border border-brand text-brand text-[14px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {generando && <CircleNotch className="w-4 h-4 animate-spin" />}
              Generar código de acceso
            </button>
          )}
        </section>
      </div>
    </div>
  )
}
