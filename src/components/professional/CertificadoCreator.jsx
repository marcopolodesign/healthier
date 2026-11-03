import { useEffect, useMemo, useState } from 'react'
import { Certificate, CircleNotch, Info, Minus, Plus, X } from '@phosphor-icons/react'
import Modal from '../Modal'
import PatientSheet from '../patient/PatientSheet'
import FirmaSheet from './FirmaSheet'
import DatosRecetaFaltantes from './DatosRecetaFaltantes'
import InfoTooltip from '../common/InfoTooltip'
import { useFirmaDelProfesional } from '../../hooks/useFirmaDelProfesional'
import { consultaNoCertificable } from '../../lib/certificadoAtencion'
import { certificadosService, nombreDelCertificado, TIPOS_CERTIFICADO } from '../../services/certificadosService'
import { toast } from '../Toast'

/**
 * "Certificado" del Recetario (2026-11-02): constancia de atención, reposo y
 * escolar, por el servicio de recetas (Edge Function `rcta-certificado`).
 *
 * Diseño de Felipe aprobado por Mateo (docs/reports/certificados-propuesta-2026-11-02):
 *  · emitidos arriba, después el formulario;
 *  · el botón principal es "Vista previa" y "Emitir certificado" vive ADENTRO
 *    de la vista previa: se revisa siempre antes de emitir;
 *  · la vista previa la arma el servidor con el MISMO payload que se emitiría
 *    (el servicio no tiene vista previa para Otras Prescripciones).
 *  · "Desde" no puede ser antes del día de la consulta.
 *  · el diagnóstico es opcional y por defecto NO va al PDF: con el interruptor
 *    apagado ni siquiera viaja al servicio.
 */

const MODELOS = ['constancia', 'reposo', 'escolar']
const TZ = 'America/Argentina/Buenos_Aires'

/** AAAA-MM-DD del día argentino. */
function diaAr(fecha) {
  return new Date(fecha).toLocaleDateString('en-CA', { timeZone: TZ })
}

function atencionLegible(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const dia = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ })
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
  return `Atención del ${dia}, ${hora}`
}

/** "J06.9 Faringitis" → código + descripción; texto libre si no arranca con un CIE-10. */
function leerDiagnostico(texto) {
  const t = texto.trim()
  const m = t.match(/^([A-TV-Z]\d{2}(?:\.\d{1,2})?)\b\s*[-·:]?\s*(.*)$/i)
  return m ? { cie10Code: m[1].toUpperCase(), cie10Display: m[2] || null } : { cie10Code: null, cie10Display: t || null }
}

function Stepper({ valor, onChange, min = 1, max = 30, etiqueta }) {
  const unidad = valor === 1 ? 'día' : 'días'
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-text-secondary">{etiqueta}</span>
      <div className="flex items-center gap-3">
        <button type="button" aria-label="Un día menos" disabled={valor <= min}
          onClick={() => onChange(Math.max(min, valor - 1))}
          className="w-10 h-10 rounded-full border border-border-default flex items-center justify-center text-text-primary disabled:opacity-40 hover:border-brand">
          <Minus className="h-4 w-4" />
        </button>
        <span className="min-w-[4.5rem] text-center text-base text-text-primary tabular-nums" aria-live="polite">
          {valor} {unidad}
        </span>
        <button type="button" aria-label="Un día más" disabled={valor >= max}
          onClick={() => onChange(Math.min(max, valor + 1))}
          className="w-10 h-10 rounded-full border border-border-default flex items-center justify-center text-text-primary disabled:opacity-40 hover:border-brand">
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/** Una hoja A4 de la vista previa, en el orden del PDF del servicio de recetas. */
function Hoja({ v, children }) {
  return (
    <div className="hoja-certificado w-full bg-white rounded-lg border border-border-subtle shadow-sm p-5 flex flex-col text-[11px] leading-snug text-black">
      <div className="text-center space-y-0.5">
        <p className="font-serif text-lg text-brand-hover">Healthier</p>
        <p>{v.medico.nombre}</p>
        <p>{v.medico.linea}</p>
        <p>{v.medico.matricula}</p>
      </div>
      <div className="mt-3 border-y border-black py-1.5 grid grid-cols-2 gap-x-2 font-semibold">
        <p>Paciente: {v.paciente.nombre}</p>
        <p className="text-right">Sexo: {v.paciente.sexo}</p>
        <p>DNI: {v.paciente.dni}</p>
        <p className="text-right">F. Nacimiento: {v.paciente.nacimiento ?? '—'}</p>
      </div>
      <div className="mt-4 flex-1">{children}</div>
      <div className="flex items-end justify-between gap-3">
        <p className="font-semibold">{v.fecha}</p>
        <div className="text-center">
          <p className="italic text-text-tertiary">{v.medico.conFirma ? '(tu firma)' : 'Sin firma cargada'}</p>
          <p>{v.medico.nombre}</p>
          <p>{v.medico.linea}</p>
          <p className="border-b border-dotted border-black pb-0.5">{v.medico.matricula}</p>
          <p>FIRMA Y SELLO</p>
        </div>
      </div>
      {v.consultorio?.length > 0 && (
        <p className="mt-3 pt-2 border-t border-black text-center">{v.consultorio.join(' · ')}</p>
      )}
    </div>
  )
}

function VistaPrevia({ open, cargando, datos, emitiendo, onEditar, onEmitir }) {
  const v = datos?.vistaPrevia
  return (
    // Más baja que las demás hojas (7rem libres arriba): dentro de la app la barra
    // con la X y el nombre del paciente tapaba el título "Vista previa" (2026-11-02).
    <PatientSheet open={open} onClose={emitiendo ? () => {} : onEditar} maxWidth="max-w-[880px]" backdropClose={!emitiendo}
      maxHeight="max-h-[calc(100dvh-7rem-env(safe-area-inset-top))]">
      <div className="shrink-0 flex items-center justify-between px-6 pt-4 sm:pt-6 pb-3">
        <h3 className="font-serif text-2xl font-light text-text-primary">Vista previa</h3>
        <button type="button" onClick={onEditar} disabled={emitiendo} aria-label="Cerrar"
          className="w-10 h-10 rounded-full bg-bg-surface border border-border-default flex items-center justify-center">
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* min-h-0: sin esto el cuerpo no se achica, la hoja crece más que la pantalla
          y el encabezado queda afuera, arriba. */}
      <div className="px-6 flex-1 min-h-0 overflow-y-auto">
        {cargando || !v ? (
          <div className="flex justify-center py-16"><CircleNotch className="h-6 w-6 animate-spin text-brand" /></div>
        ) : (
          <div className={`grid gap-4 pb-2 ${v.indicaciones ? 'sm:grid-cols-2' : 'sm:max-w-[420px] sm:mx-auto'}`}>
            <div className="space-y-1">
              <p className="text-xs text-text-tertiary">Hoja 1</p>
              <Hoja v={v}>
                <p className="font-semibold">Rp./</p>
                <p className="mt-1">- {v.titulo}</p>
                <p>{v.cuerpo}</p>
                {v.diagnostico && <p className="mt-1"><span className="font-semibold">Diagnóstico:</span> {v.diagnostico}</p>}
              </Hoja>
            </div>
            {v.indicaciones && (
              <div className="space-y-1">
                <p className="text-xs text-text-tertiary">Hoja 2</p>
                <Hoja v={v}>
                  <p className="font-semibold">Indicaciones:</p>
                  <p className="mt-1 whitespace-pre-line">{v.indicaciones}</p>
                </Hoja>
              </div>
            )}
          </div>
        )}
        {datos?.faltan?.length > 0 && (
          <p className="text-sm text-amber-800 rounded-lg bg-amber-50 border border-amber-200 p-3 mt-2">
            Faltan datos para emitir: completalos arriba, en el aviso del recetario.
          </p>
        )}
      </div>
      <div className="shrink-0 flex gap-3 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-border-subtle mt-3">
        <button type="button" onClick={onEditar} disabled={emitiendo} className="btn-secondary flex-1 py-3">Editar</button>
        <button type="button" onClick={onEmitir} disabled={emitiendo || cargando || !v || datos?.faltan?.length > 0}
          className="btn-primary flex-[2] py-3 flex items-center justify-center gap-2">
          {emitiendo ? <><CircleNotch className="h-4 w-4 animate-spin" /> Emitiendo…</> : 'Emitir certificado'}
        </button>
      </div>
    </PatientSheet>
  )
}

export default function CertificadoCreator({
  consultationId, encounterId, consultaFecha, consulta = null, professionalId,
  profile, profProfile, paciente, patientId, onDatosActualizados, enPractica = false,
}) {
  // Aviso antes de armar nada; el corte real lo hace rcta-certificado.
  const noCertificable = consulta && !enPractica ? consultaNoCertificable(consulta, Date.now()) : null
  const hoy = diaAr(new Date())
  const minimo = consultaFecha ? diaAr(consultaFecha) : hoy
  const desdeInicial = hoy < minimo ? minimo : hoy

  const [emitidos, setEmitidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [tipo, setTipo] = useState('reposo')
  const [dias, setDias] = useState(1)
  const [desde, setDesde] = useState(desdeInicial)
  const [indicaciones, setIndicaciones] = useState('')
  const [diagnostico, setDiagnostico] = useState('')
  const [imprimirDiagnostico, setImprimirDiagnostico] = useState(false)
  const [previa, setPrevia] = useState(null) // null = cerrada
  const [cargandoPrevia, setCargandoPrevia] = useState(false)
  const [emitiendo, setEmitiendo] = useState(false)
  const [firmaPendiente, setFirmaPendiente] = useState(false)
  const [aAnular, setAAnular] = useState(null)
  const [anulando, setAnulando] = useState(false)
  const { tieneFirma, cargando: cargandoFirma, marcar: marcarFirma } = useFirmaDelProfesional(professionalId)

  const recargar = () => certificadosService.listarDeConsulta(consultationId)
    .then(setEmitidos).catch(() => setEmitidos([])).finally(() => setCargando(false))
  useEffect(() => { recargar() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [consultationId])

  useEffect(() => { if (!diagnostico.trim()) setImprimirDiagnostico(false) }, [diagnostico])

  const datos = useMemo(() => ({
    consultationId, encounterId, tipo,
    ...(tipo !== 'constancia' ? { dias, desde } : {}),
    indicaciones: indicaciones.trim() || null,
    ...leerDiagnostico(diagnostico),
    imprimirDiagnostico,
  }), [consultationId, encounterId, tipo, dias, desde, indicaciones, diagnostico, imprimirDiagnostico])

  async function abrirVistaPrevia() {
    setPrevia({})
    setCargandoPrevia(true)
    try {
      setPrevia(await certificadosService.vistaPrevia(datos))
    } catch (err) {
      setPrevia(null)
      toast.error(`No se pudo armar la vista previa: ${err.message}`)
    } finally {
      setCargandoPrevia(false)
    }
  }

  // `firmaRecienCargada`: viene de FirmaSheet. En ese render `tieneFirma` todavía
  // es false (el estado se actualiza después), y sin esto la hoja se reabría en
  // vez de emitir.
  async function emitir({ firmaRecienCargada = false } = {}) {
    if (!tieneFirma && !firmaRecienCargada) { setFirmaPendiente(true); return }
    setEmitiendo(true)
    try {
      const { recuperado } = await certificadosService.emitir(datos)
      setPrevia(null)
      if (recuperado) {
        // Lo que se recuperó es el del intento anterior, no necesariamente lo
        // que hay ahora en el formulario: se deja el formulario como está.
        toast.success('Ya estaba emitido un certificado de este tipo de un intento anterior: revisalo en la lista. Si necesitás otro distinto, emitilo de nuevo.')
        return
      }
      toast.success('Certificado emitido')
      setIndicaciones('')
      setDiagnostico('')
      setDias(1)
      setDesde(desdeInicial)
    } catch (err) {
      if (err.code === 'RCTA_FIRMA_FALTANTE') setFirmaPendiente(true)
      else toast.error(`No se pudo emitir el certificado: ${err.message}`)
    } finally {
      setEmitiendo(false)
      recargar()
    }
  }

  async function confirmarAnular() {
    setAnulando(true)
    try {
      const r = await certificadosService.anular(aAnular.id)
      if (r.estado === 'error') toast.warning(`Quedó anulado en Healthier, pero el servicio no lo confirmó: ${r.detalle ?? ''}`)
      else toast.success('Certificado anulado')
      setAAnular(null)
    } catch (err) {
      toast.error(`No se pudo anular: ${err.message}`)
    } finally {
      setAnulando(false)
      recargar()
    }
  }

  if (enPractica) {
    return <p className="text-sm text-text-secondary">En la práctica no se emiten certificados.</p>
  }

  const hora = c => new Date(c.rctaIssuedAt ?? c.createdAt).toLocaleString('es-AR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ,
  })

  return (
    <div className="space-y-4">

      <Modal open={!!aAnular} onClose={anulando ? () => {} : () => setAAnular(null)} title="¿Anular este certificado?" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">Deja de estar disponible para el paciente.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAAnular(null)} disabled={anulando} className="btn-secondary flex-1 py-2">Volver</button>
            <button type="button" onClick={confirmarAnular} disabled={anulando}
              className="btn-danger flex-1 py-2 flex items-center justify-center gap-1.5">
              {anulando ? <><CircleNotch className="h-4 w-4 animate-spin" /> Anulando…</> : 'Anular'}
            </button>
          </div>
        </div>
      </Modal>

      <VistaPrevia
        open={previa !== null}
        cargando={cargandoPrevia}
        datos={previa}
        emitiendo={emitiendo}
        onEditar={() => setPrevia(null)}
        onEmitir={() => emitir()}
      />

      {/* Después de la vista previa a propósito: se abre ENCIMA de ella (si va antes,
          queda tapada y parece que "Emitir" no hace nada). */}
      <FirmaSheet
        open={firmaPendiente}
        userId={professionalId}
        onClose={() => setFirmaPendiente(false)}
        onFirmada={() => { setFirmaPendiente(false); marcarFirma(true); emitir({ firmaRecienCargada: true }) }}
      />

      <DatosRecetaFaltantes
        profile={profile}
        profProfile={profProfile}
        paciente={paciente}
        patientId={patientId}
        consultationId={consultationId}
        onActualizado={onDatosActualizados}
      />

      {!cargando && emitidos.length > 0 && (
        <div className="space-y-2">
          {emitidos.map(c => {
            const anulado = c.status === 'anulado'
            if (c.aRevisar) return (
              <div key={c.id} data-testid="certificado-a-revisar" className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3">
                <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shrink-0">
                  <Certificate className="h-5 w-5 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{nombreDelCertificado(c)}</p>
                  <p className="text-xs text-amber-700">Puede haber salido: lo revisa Healthier antes de emitir otro.</p>
                </div>
              </div>
            )
            return (
              <div key={c.id} className={`flex items-center gap-3 rounded-2xl border border-border-default bg-bg-surface p-3 ${anulado ? 'opacity-60' : ''}`}>
                <div className="w-9 h-9 rounded-xl bg-brand-muted flex items-center justify-center shrink-0">
                  <Certificate className="h-5 w-5 text-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{nombreDelCertificado(c)}</p>
                  <p className="text-xs text-text-tertiary">{hora(c)}</p>
                </div>
                {anulado ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-bg-surface-hover text-text-secondary">Anulado</span>
                ) : (
                  <div className="flex items-center gap-3 shrink-0">
                    {c.rctaPdfUrl && (
                      <a href={c.rctaPdfUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand">Ver PDF</a>
                    )}
                    {c.professionalId === professionalId && (
                      <button type="button" onClick={() => setAAnular(c)} className="text-sm text-text-tertiary hover:text-danger">Anular</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div role="radiogroup" aria-label="Modelo de certificado" className="grid grid-cols-3 gap-1 p-1 rounded-full bg-bg-surface-hover">
        {MODELOS.map(m => (
          <button key={m} type="button" role="radio" aria-checked={tipo === m} onClick={() => setTipo(m)}
            className={`py-2 rounded-full text-sm transition-colors ${tipo === m ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}>
            {TIPOS_CERTIFICADO[m].label}
          </button>
        ))}
      </div>

      {tipo === 'constancia' ? (
        <p className="text-sm text-text-primary first-letter:uppercase">{atencionLegible(consultaFecha) ?? 'Atención de hoy'}</p>
      ) : (
        <div className="space-y-4">
          <Stepper valor={dias} onChange={setDias} etiqueta={tipo === 'escolar' ? 'Días de inasistencia' : 'Días'} />
          <div>
            <label className="form-label" htmlFor="cert-desde">Desde</label>
            <input id="cert-desde" type="date" className="form-input" value={desde} min={minimo}
              onChange={e => setDesde(e.target.value < minimo ? minimo : e.target.value)} />
          </div>
        </div>
      )}

      <div>
        <label className="form-label" htmlFor="cert-indicaciones">Indicaciones <span className="text-text-tertiary font-normal">(opcional)</span></label>
        <textarea id="cert-indicaciones" rows={3} maxLength={1000} className="form-textarea resize-none"
          placeholder="Ej.: evitar esfuerzos físicos" value={indicaciones} onChange={e => setIndicaciones(e.target.value)} />
      </div>

      <div className="space-y-3">
        <div>
          <label className="form-label" htmlFor="cert-dx">Diagnóstico <span className="text-text-tertiary font-normal">(opcional)</span></label>
          <input id="cert-dx" type="text" className="form-input" maxLength={200}
            placeholder="CIE-10 o texto, ej.: J06.9 Faringitis" value={diagnostico} onChange={e => setDiagnostico(e.target.value)} />
        </div>
        {diagnostico.trim() && (
          <label className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-sm text-text-primary">
              Incluir el diagnóstico en el certificado
              <InfoTooltip label="Lo ve quien reciba el certificado." align="left">
                <Info className="h-4 w-4 text-text-tertiary" />
              </InfoTooltip>
            </span>
            <input type="checkbox" role="switch" className="switch-bonificar" checked={imprimirDiagnostico}
              onChange={e => setImprimirDiagnostico(e.target.checked)} />
          </label>
        )}
      </div>

      {noCertificable && (
        <p className="text-sm text-amber-700" data-testid="certificado-no-disponible" role="alert">{noCertificable.error}</p>
      )}
      <button type="button" onClick={abrirVistaPrevia} disabled={cargandoFirma || !!noCertificable}
        className="btn-primary w-full py-3">
        Vista previa
      </button>
    </div>
  )
}

