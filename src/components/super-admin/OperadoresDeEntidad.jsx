import { useState, useEffect } from 'react'
import { UsersThree } from '@phosphor-icons/react'
import { dispatchService } from '../../services/dispatchService'

/**
 * Super admin (regla de visibilidad): por cada entidad de emergencias, los
 * profesionales con los que pueden ingresar sus cuentas operador, el estado de
 * su Mercado Pago y el log de ingresos en modo operador (quién entró como quién,
 * por qué cuenta y quién lo aprobó). Migraciones 241-243.
 */
export default function OperadoresDeEntidad() {
  const [entidades, setEntidades] = useState([])
  const [ingresos, setIngresos] = useState([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const ents = await dispatchService.listarEntidades()
        const conDatos = await Promise.all(ents.map(async e => {
          const [profesionales, mp] = await Promise.all([
            dispatchService.listarProfesionalesDeEntidad(e.id).catch(() => []),
            dispatchService.estadoMp(e.id).catch(() => ({ conectado: false })),
          ])
          return { ...e, profesionales, mp }
        }))
        const log = await dispatchService.ingresosEnModoOperador(30)
        if (vivo) { setEntidades(conDatos); setIngresos(log) }
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => { vivo = false }
  }, [])

  if (cargando) return null

  return (
    <div className="card space-y-4" data-testid="operadores-de-entidad">
      <h2 className="font-semibold text-text-primary flex items-center gap-2">
        <UsersThree className="h-5 w-5 text-brand" /> Operadores y profesionales por entidad
      </h2>
      {entidades.map(e => (
        <div key={e.id} className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-text-primary">{e.name}</p>
            <span className={`text-xs font-semibold ${e.mp?.conectado ? 'text-emerald-700' : 'text-red-600'}`}>
              Mercado Pago: {e.mp?.conectado ? `conectado${e.mp.nickname ? ` (${e.mp.nickname})` : ''}` : 'no conectado — cobra Healthier'}
            </span>
          </div>
          {e.profesionales.length === 0 ? (
            <p className="text-xs text-text-secondary">Sin profesionales cargados</p>
          ) : (
            <ul className="text-xs text-text-secondary space-y-0.5">
              {e.profesionales.map(p => (
                <li key={p.id}>
                  {p.profile?.fullName || p.profile?.email} · {p.profile?.dni ? `DNI ${p.profile.dni}` : 'sin DNI'}{p.verificado ? '' : ' · sin verificar'}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <div className="pt-3 border-t border-border-default space-y-1">
        <p className="text-xs font-semibold text-text-secondary">Ingresos en modo operador (últimos 30 días)</p>
        {ingresos.length === 0 ? (
          <p className="text-xs text-text-secondary">Todavía no hubo ingresos</p>
        ) : ingresos.map(i => (
          <p key={i.id} className="text-xs text-text-secondary">
            {i.dia} · {i.operador?.email} entró como {i.profesional?.fullName} (DNI {i.dniIngresado})
            {i.aprobador?.fullName ? ` · aprobó ${i.aprobador.fullName}` : ''}
          </p>
        ))}
      </div>
    </div>
  )
}
