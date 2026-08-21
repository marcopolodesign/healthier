import { useState, useEffect } from 'react'
import { ShareNetwork, Copy, Check, CaretRight, X } from '@phosphor-icons/react'
import { referralService } from '../../services/referralService'
import { toast } from '../../components/Toast'
import { formatDate } from '../../lib/format'

function Metric({ label, value, hint }) {
  return (
    <div className="card">
      <p className="text-xs text-text-secondary font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold text-text-primary mt-1">{value}</p>
      {hint && <p className="text-xs text-text-tertiary mt-0.5">{hint}</p>}
    </div>
  )
}

export default function SuperAdminReferidos() {
  const [filas, setFilas] = useState([])
  const [loading, setLoading] = useState(true)
  const [copiado, setCopiado] = useState(null)
  const [detalle, setDetalle] = useState(null)   // { pro, pacientes } | null
  const [cargandoDetalle, setCargandoDetalle] = useState(false)
  const [soloConActividad, setSoloConActividad] = useState(false)

  useEffect(() => {
    setLoading(true)
    referralService.summary()
      .then(setFilas)
      .catch(err => toast.error(err.message || 'Error al cargar los referidos'))
      .finally(() => setLoading(false))
  }, [])

  const copiar = async (codigo) => {
    try {
      await navigator.clipboard.writeText(referralService.buildUrl(codigo))
      setCopiado(codigo)
      setTimeout(() => setCopiado(null), 2000)
    } catch {
      toast.error('No se pudo copiar el link')
    }
  }

  const abrirDetalle = async (pro) => {
    setCargandoDetalle(true)
    setDetalle({ pro, pacientes: null })
    try {
      const pacientes = await referralService.patientsOf(pro.professionalId)
      setDetalle({ pro, pacientes })
    } catch (err) {
      toast.error(err.message || 'No se pudieron cargar los referidos')
      setDetalle(null)
    } finally {
      setCargandoDetalle(false)
    }
  }

  const visibles = soloConActividad
    ? filas.filter(f => f.visitas > 0 || f.registros > 0)
    : filas

  const totalVisitas = filas.reduce((s, f) => s + Number(f.visitas), 0)
  const totalRegistros = filas.reduce((s, f) => s + Number(f.registros), 0)
  const totalConConsulta = filas.reduce((s, f) => s + Number(f.conConsulta), 0)
  const conActividad = filas.filter(f => f.visitas > 0 || f.registros > 0).length

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="page-title-lg">Referidos</h1>
        <p className="text-text-secondary mt-1">
          El link que cada profesional le manda a sus pacientes, y qué pasó con él
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric
          label="Profesionales que lo usaron"
          value={loading ? '—' : conActividad}
          hint={loading ? '' : `de ${filas.length} con link`}
        />
        <Metric label="Visitas al link" value={loading ? '—' : totalVisitas} />
        <Metric
          label="Se registraron"
          value={loading ? '—' : totalRegistros}
          hint={!loading && totalVisitas > 0 ? `${Math.round((totalRegistros / totalVisitas) * 100)}% de las visitas` : ''}
        />
        <Metric
          label="Ya sacaron turno"
          value={loading ? '—' : totalConConsulta}
          hint={!loading && totalRegistros > 0 ? `${Math.round((totalConConsulta / totalRegistros) * 100)}% de los registrados` : ''}
        />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <h2 className="font-semibold text-text-primary">Por profesional</h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSoloConActividad(v => !v)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                soloConActividad ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Sólo con actividad
            </button>
            <span className="text-xs text-text-secondary">{visibles.length} de {filas.length}</span>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-10 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : visibles.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <ShareNetwork className="h-10 w-10 text-text-muted mb-3" />
            <p className="text-text-secondary text-sm">
              {soloConActividad
                ? 'Todavía ningún profesional movió su link'
                : 'No hay profesionales con link generado'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr>
                  <th className="table-header">Profesional</th>
                  <th className="table-header">Link</th>
                  <th className="table-header text-right">Visitas</th>
                  <th className="table-header text-right">Registros</th>
                  <th className="table-header text-right">Con turno</th>
                  <th className="table-header">Última visita</th>
                  <th className="table-header w-8" />
                </tr>
              </thead>
              <tbody>
                {visibles.map(f => (
                  <tr
                    key={f.professionalId}
                    className="table-row cursor-pointer"
                    onClick={() => Number(f.registros) > 0 && abrirDetalle(f)}
                  >
                    <td className="table-cell">
                      <p className="text-text-primary truncate max-w-[200px]">{f.fullName || '—'}</p>
                      <p className="text-xs text-text-tertiary truncate max-w-[200px]">{f.email}</p>
                    </td>
                    <td className="table-cell">
                      <button
                        onClick={e => { e.stopPropagation(); copiar(f.referralCode) }}
                        className="inline-flex items-center gap-1.5 font-mono text-xs text-brand hover:underline"
                        title={referralService.buildUrl(f.referralCode)}
                      >
                        /r/{f.referralCode}
                        {copiado === f.referralCode
                          ? <Check className="h-3.5 w-3.5" />
                          : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                    <td className="table-cell text-right font-semibold">{f.visitas}</td>
                    <td className="table-cell text-right font-semibold">{f.registros}</td>
                    <td className="table-cell text-right font-semibold">{f.conConsulta}</td>
                    <td className="table-cell whitespace-nowrap text-text-tertiary">
                      {f.ultimaVisita ? formatDate(f.ultimaVisita) : '—'}
                    </td>
                    <td className="table-cell">
                      {Number(f.registros) > 0 && <CaretRight className="h-4 w-4 text-text-tertiary" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detalle && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setDetalle(null)}>
          <aside
            className="w-full max-w-md h-full bg-bg-primary overflow-y-auto p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase">Referidos de</p>
                <h2 className="text-xl font-light text-text-primary mt-1">{detalle.pro.fullName}</h2>
                <p className="font-mono text-xs text-brand mt-1">/r/{detalle.pro.referralCode}</p>
              </div>
              <button onClick={() => setDetalle(null)} className="p-1 text-text-tertiary hover:text-text-primary">
                <X className="h-5 w-5" />
              </button>
            </div>

            {cargandoDetalle || !detalle.pacientes ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-14 bg-bg-surface rounded-lg animate-pulse" />)}</div>
            ) : (
              <ul className="space-y-2">
                {detalle.pacientes.map(p => (
                  <li key={p.patientId} className="card py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-text-primary truncate">{p.fullName || '—'}</p>
                        <p className="text-xs text-text-tertiary truncate">{p.email}</p>
                      </div>
                      <span className="text-xs text-text-secondary whitespace-nowrap">
                        {Number(p.consultas) > 0
                          ? `${p.consultas} consulta${Number(p.consultas) === 1 ? '' : 's'}`
                          : 'Sin turnos'}
                      </span>
                    </div>
                    <p className="text-xs text-text-tertiary mt-1.5">
                      Se registró el {formatDate(p.createdAt)}
                      {p.primeraConsulta && ` · primer turno el ${formatDate(p.primeraConsulta)}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
