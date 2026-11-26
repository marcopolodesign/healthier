import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Check, DownloadSimple, Handshake } from '@phosphor-icons/react'
import { referralService, SITIO_PUBLICO } from '../../services/referralService'
import { toast } from '../../components/Toast'
import { formatARS } from '../../lib/format'
import MetricCard from '../../components/super-admin/MetricCard'
import IncluirPruebaToggle from '../../components/super-admin/IncluirPruebaToggle'
import { useIncluirPrueba } from '../../hooks/useIncluirPrueba'

const ESTADO_DESCUENTO = {
  aplicado: 'Usado',
  reservado: 'En curso',
  liberado: 'Disponible',
}

/** "25/11 · 21:17" en hora de Buenos Aires. */
function fechaCorta(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const tz = { timeZone: 'America/Argentina/Buenos_Aires' }
  const dia = d.toLocaleDateString('es-AR', { ...tz, day: '2-digit', month: '2-digit' })
  const hora = d.toLocaleTimeString('es-AR', { ...tz, hour: '2-digit', minute: '2-digit', hour12: false })
  return `${dia} · ${hora}`
}

/** 'YYYY-MM-01' del mes actual en hora local. */
function mesActual() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function ultimosMeses(n = 12) {
  const out = []
  const d = new Date()
  d.setDate(1)
  for (let i = 0; i < n; i++) {
    const valor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    out.push({ valor, label: d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) })
    d.setMonth(d.getMonth() - 1)
  }
  return out
}

/**
 * `/super-admin/socios` — socios comerciales (LIFT): su link y QR, quiénes
 * entraron por ellos, el descuento de primera consulta y la liquidación del mes
 * (el % del socio por cada consulta terminada, que se transfiere a mano).
 * Migración 252.
 */
export default function SuperAdminSocios() {
  const [incluirPrueba] = useIncluirPrueba()
  const [socios, setSocios] = useState([])
  const [loading, setLoading] = useState(true)
  const [socioId, setSocioId] = useState(null)
  const [atribuidos, setAtribuidos] = useState(null)
  const [mes, setMes] = useState(mesActual())
  const [liquidacion, setLiquidacion] = useState(null)
  const [qr, setQr] = useState(null)
  const [copiado, setCopiado] = useState(false)
  const meses = useMemo(() => ultimosMeses(), [])

  useEffect(() => {
    setLoading(true)
    referralService.socios({ incluirPrueba })
      .then(rows => {
        setSocios(rows)
        setSocioId(prev => prev ?? rows[0]?.socioId ?? null)
      })
      .catch(err => toast.error(err.message || 'Error al cargar los socios'))
      .finally(() => setLoading(false))
  }, [incluirPrueba])

  const socio = socios.find(s => s.socioId === socioId) ?? null
  const link = socio ? `${SITIO_PUBLICO}/r/${socio.codigo}` : null

  useEffect(() => {
    if (!link) return
    QRCode.toDataURL(link, { width: 512, margin: 2 }).then(setQr).catch(() => setQr(null))
  }, [link])

  useEffect(() => {
    if (!socioId) return
    setAtribuidos(null)
    referralService.atribuidosDeSocio(socioId, { incluirPrueba })
      .then(setAtribuidos)
      .catch(err => { toast.error(err.message || 'Error al cargar los socios atribuidos'); setAtribuidos([]) })
  }, [socioId, incluirPrueba])

  useEffect(() => {
    if (!socioId) return
    setLiquidacion(null)
    referralService.liquidacionDeSocio(socioId, mes, { incluirPrueba })
      .then(setLiquidacion)
      .catch(err => { toast.error(err.message || 'Error al cargar la liquidación'); setLiquidacion([]) })
  }, [socioId, mes, incluirPrueba])

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      toast.error('No se pudo copiar el link')
    }
  }

  const totalSocio = (liquidacion ?? []).reduce((s, f) => s + Number(f.montoSocio || 0), 0)
  const totalCobrado = (liquidacion ?? []).reduce((s, f) => s + Number(f.cobrado || 0), 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title-lg">Socios comerciales</h1>
        <p className="text-text-secondary mt-1">
          Quién entró por su link, el descuento usado y lo que se le liquida cada mes.
        </p>
        <IncluirPruebaToggle className="mt-3" />
      </div>

      {socios.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {socios.map(s => (
            <button
              key={s.socioId}
              onClick={() => setSocioId(s.socioId)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${s.socioId === socioId ? 'bg-brand text-white' : 'bg-bg-surface text-text-secondary hover:bg-brand-muted'}`}
            >
              {s.nombre}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="h-40 bg-bg-surface rounded-2xl animate-pulse" />
      ) : !socio ? (
        <div className="card flex flex-col items-center py-12 text-center">
          <Handshake className="h-10 w-10 text-text-muted mb-3" />
          <p className="text-text-secondary text-sm">Todavía no hay socios comerciales cargados</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Se sumaron" value={socio.atribuidos} hint={`por el link o el código de ${socio.nombre}`} />
            <MetricCard label="Con consulta terminada" value={socio.conConsulta} hint="de los que se sumaron" />
            <MetricCard
              label="Descuentos usados"
              value={socio.descuentosAplicados}
              hint={`${Math.round(Number(socio.descuento) * 100)}% en la primera consulta`}
            />
            <MetricCard label="Descontado en total" value={formatARS(Number(socio.descuentosMonto))} hint="lo pone Healthier de su comisión" />
          </div>

          <div className="card flex flex-col sm:flex-row gap-6 items-start">
            {qr && <img src={qr} alt={`QR de ${socio.nombre}`} className="w-40 h-40 rounded-xl bg-white shrink-0" />}
            <div className="min-w-0 space-y-3">
              <div>
                <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase">Link y código</p>
                <button onClick={copiar} className="inline-flex items-center gap-1.5 font-mono text-sm text-brand hover:underline mt-1 break-all">
                  {link} {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
                <p className="text-sm text-text-secondary mt-1">
                  Código para cargar a mano: <span className="font-mono text-text-primary uppercase">{socio.codigo}</span>
                </p>
              </div>
              <p className="text-sm text-text-secondary">
                {Math.round(Number(socio.descuento) * 100)}% off en la primera consulta · {Math.round(Number(socio.comisionSocio) * 100)}% para {socio.nombre} de cada consulta terminada de sus socios
                {!socio.activo && ' · inactivo'}
              </p>
              {qr && (
                <a href={qr} download={`qr-${socio.codigo}.png`} className="btn-secondary inline-flex items-center gap-2 text-sm">
                  <DownloadSimple className="h-4 w-4" /> Descargar QR
                </a>
              )}
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <h2 className="font-semibold text-text-primary">Liquidación a {socio.nombre}</h2>
              <select value={mes} onChange={e => setMes(e.target.value)} className="form-select w-auto" aria-label="Mes">
                {meses.map(m => <option key={m.valor} value={m.valor}>{m.label}</option>)}
              </select>
            </div>
            {liquidacion === null ? (
              <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-10 bg-bg-surface rounded-lg animate-pulse" />)}</div>
            ) : liquidacion.length === 0 ? (
              <p className="text-sm text-text-secondary py-6 text-center">No hay consultas terminadas de socios en este mes</p>
            ) : (
              <>
                <div className="flex gap-6 flex-wrap mb-4">
                  <div>
                    <p className="text-xs text-text-tertiary">A transferir</p>
                    <p className="text-2xl font-light text-text-primary" data-testid="liquidacion-total">{formatARS(totalSocio)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-tertiary">Cobrado en esas consultas</p>
                    <p className="text-2xl font-light text-text-primary">{formatARS(totalCobrado)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-tertiary">Consultas</p>
                    <p className="text-2xl font-light text-text-primary">{liquidacion.length}</p>
                  </div>
                </div>
                <div className="overflow-x-auto -mx-4 sm:mx-0">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr>
                        <th className="table-header">Terminada</th>
                        <th className="table-header">Paciente</th>
                        <th className="table-header">Profesional</th>
                        <th className="table-header text-right">Precio</th>
                        <th className="table-header text-right">Descuento</th>
                        <th className="table-header text-right">Cobrado</th>
                        <th className="table-header text-right">{socio.nombre}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liquidacion.map(f => (
                        <tr key={f.consultationId} className="table-row">
                          <td className="table-cell whitespace-nowrap">{fechaCorta(f.completedAt)}</td>
                          <td className="table-cell">{f.paciente || '—'}</td>
                          <td className="table-cell">{f.profesional || '—'}</td>
                          <td className="table-cell text-right">{formatARS(Number(f.precioLista))}</td>
                          <td className="table-cell text-right">{Number(f.descuento) > 0 ? `−${formatARS(Number(f.descuento))}` : '—'}</td>
                          <td className="table-cell text-right">{formatARS(Number(f.cobrado))}</td>
                          <td className="table-cell text-right font-semibold">{formatARS(Number(f.montoSocio))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h2 className="font-semibold text-text-primary mb-4">Socios que se sumaron</h2>
            {atribuidos === null ? (
              <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-10 bg-bg-surface rounded-lg animate-pulse" />)}</div>
            ) : atribuidos.length === 0 ? (
              <p className="text-sm text-text-secondary py-6 text-center">Todavía nadie entró con el link o el código</p>
            ) : (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full min-w-[700px] text-sm">
                  <thead>
                    <tr>
                      <th className="table-header">Paciente</th>
                      <th className="table-header">Entró por</th>
                      <th className="table-header">Desde</th>
                      <th className="table-header">Descuento</th>
                      <th className="table-header text-right">Consultas terminadas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {atribuidos.map(a => (
                      <tr key={a.pacienteId} className="table-row">
                        <td className="table-cell">
                          <p className="text-text-primary truncate max-w-[220px]">{a.nombre || '—'}</p>
                          <p className="text-xs text-text-tertiary truncate max-w-[220px]">{a.email}</p>
                        </td>
                        <td className="table-cell">{a.origen === 'link' ? 'Link / QR' : a.origen === 'codigo' ? 'Código' : 'Administración'}</td>
                        <td className="table-cell whitespace-nowrap">{fechaCorta(a.atribuidoAt)}</td>
                        <td className="table-cell">
                          {a.descuentoEstado
                            ? `${ESTADO_DESCUENTO[a.descuentoEstado]}${a.descuentoEstado !== 'liberado' ? ` · ${formatARS(Number(a.descuentoMonto))}` : ''}`
                            : 'Disponible'}
                        </td>
                        <td className="table-cell text-right font-semibold">{a.consultasTerminadas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
