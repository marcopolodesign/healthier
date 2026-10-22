import { useEffect, useRef, useState } from 'react'
import { Camera, CircleNotch, WarningCircle } from '@phosphor-icons/react'
import { ordenTrasladoService, ultimosPorTipo, TIPOS_FOTO_ORDEN } from '../../services/ordenTrasladoService'
import { horaDeOrden } from './OrdenDeTrasladoCard'

/**
 * "¿Cómo terminó?" al cerrar una emergencia (migración 213; Nacho, 2026-10-22;
 * diseño revisado por Felipe). Aparece sólo al cerrar. Sin nada elegido de
 * entrada: es una declaración con peso legal, no puede salir por default.
 *
 * Con "Trasladado" pide la institución y la foto de la orden firmada y sellada
 * por el médico y por la institución. La foto se sube en el momento (la base
 * le pone la hora); "Cambiar foto" sube otra y vale la última. Sin foto, la
 * base no deja cerrar.
 *
 * `valor`: { desenlace, institucion, orden }. `faltaParaCerrar(valor)` dice
 * qué falta, para el texto debajo del botón deshabilitado.
 */
export function faltaParaCerrar(valor) {
  if (!valor?.desenlace) return 'Elegí cómo terminó'
  if (valor.desenlace === 'traslado') {
    if (!valor.institucion?.trim()) return 'Falta la institución'
    if (!valor.orden) return 'Falta la foto de la orden'
  }
  return ''
}

const OPCIONES = [
  { id: 'en_el_lugar', label: 'En el lugar' },
  { id: 'traslado', label: 'Trasladado' },
]

/**
 * `paraDespacho`: lo usa el despacho al terminar (web). Cambia la ayuda ("el
 * médico", no "vos") y, si la tripulación ya subió la orden, deja "Trasladado"
 * marcado (Felipe, 2026-10-22).
 */
export default function CierreDesenlace({ emergencyId, valor, onChange, paraDespacho = false }) {
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')
  const [ultimoArchivo, setUltimoArchivo] = useState(null)
  const [vista, setVista] = useState(null)
  const camara = useRef(null)
  const galeria = useRef(null)
  // En el teléfono, un botón abre la cámara y otro las fotos; en la compu, uno solo.
  const [esTactil] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)

  useEffect(() => () => { if (vista?.startsWith('blob:')) URL.revokeObjectURL(vista) }, [vista])

  // `onChange` es un setState: se usan actualizaciones funcionales.
  const set = cambios => onChange(prev => ({ ...prev, ...cambios }))

  // Si ya hay una orden subida (se recargó la página), se retoma.
  useEffect(() => {
    let vivo = true
    ordenTrasladoService.listar(emergencyId)
      .then(async lista => {
        const ultima = ultimosPorTipo(lista).orden_traslado
        if (!vivo || !ultima) return
        onChange(prev => (prev.orden ? prev : {
          ...prev, orden: ultima, institucion: ultima.institucion,
          desenlace: prev.desenlace ?? (paraDespacho ? 'traslado' : null),
        }))
        const url = await ordenTrasladoService.urlFoto(ultima.fotoPath).catch(() => null)
        if (vivo && url) setVista(v => v ?? url)
      })
      .catch(() => {})
    return () => { vivo = false }
  }, [emergencyId, onChange, paraDespacho])

  async function subir(file) {
    if (!file) return
    setUltimoArchivo(file)
    setSubiendo(true)
    setError('')
    try {
      const orden = await ordenTrasladoService.subir(emergencyId, file, { institucion: valor.institucion })
      setVista(URL.createObjectURL(file))
      set({ orden })
    } catch (e) {
      setError(e?.message || 'No pudimos subir la foto.')
    } finally {
      setSubiendo(false)
      if (camara.current) camara.current.value = ''
      if (galeria.current) galeria.current.value = ''
    }
  }

  const traslado = valor.desenlace === 'traslado'
  const institucionLista = !!valor.institucion?.trim()

  return (
    <div className="space-y-3" data-testid="cierre-desenlace">
      <p className="font-semibold text-text-primary">¿Cómo terminó?</p>
      <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-bg-secondary border border-border-default" role="radiogroup" aria-label="Cómo terminó">
        {OPCIONES.map(o => {
          const activo = valor.desenlace === o.id
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={activo}
              onClick={() => set({ desenlace: o.id })}
              className={`min-h-14 rounded-xl text-base font-semibold transition-colors ${activo ? 'bg-gray-950 text-white' : 'text-text-primary'}`}
            >
              {o.label}
            </button>
          )
        })}
      </div>

      {traslado && (
        <div className="space-y-3">
          <div>
            <label htmlFor="institucion-destino" className="form-label">Institución que lo recibe</label>
            <input
              id="institucion-destino"
              className="form-input min-h-14"
              value={valor.institucion ?? ''}
              onChange={e => set({ institucion: e.target.value })}
              placeholder="Ej. Hospital Fernández"
              maxLength={200}
              disabled={!!valor.orden || subiendo}
            />
          </div>

          {valor.orden ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-bg-surface border border-border-default">
                  {vista && <img src={vista} alt="Orden de traslado" className="w-full h-full object-cover" />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text-primary tabular-nums">Orden subida · {horaDeOrden(valor.orden.subidaAt)}</p>
                  <button type="button" className="text-sm font-semibold text-text-primary underline" onClick={() => set({ orden: null })}>
                    Cambiar foto
                  </button>
                </div>
              </div>
              <p className="text-sm text-text-secondary">Al cerrar queda guardada y no se puede cambiar.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => subir(e.target.files?.[0])} />
              <input ref={galeria} type="file" accept={TIPOS_FOTO_ORDEN.join(',')} className="hidden" onChange={e => subir(e.target.files?.[0])} />
              <button
                type="button"
                disabled={!institucionLista || subiendo}
                onClick={() => (esTactil ? camara : galeria).current?.click()}
                className="w-full min-h-14 rounded-[24px] border-2 border-gray-950 text-gray-950 font-bold text-lg flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {subiendo
                  ? <><CircleNotch className="h-5 w-5 animate-spin" /> Subiendo…</>
                  : <><Camera className="h-5 w-5" /> {esTactil ? 'Sacar foto de la orden' : 'Subir foto de la orden'}</>}
              </button>
              {esTactil && (
                <button type="button" disabled={!institucionLista || subiendo} onClick={() => galeria.current?.click()} className="w-full text-sm font-semibold text-text-primary underline disabled:opacity-40">
                  Elegir de fotos
                </button>
              )}
              <p className="text-sm text-text-secondary">
                {paraDespacho ? 'Firmada y sellada por el médico y por la institución.' : 'Firmada y sellada por vos y por la institución.'}
              </p>
              {error && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-danger/5 text-sm text-danger" role="alert">
                  <WarningCircle className="h-5 w-5 shrink-0" />
                  <span className="flex-1">{error}</span>
                  {ultimoArchivo && <button type="button" className="font-semibold underline" onClick={() => subir(ultimoArchivo)}>Reintentar</button>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Foto de la negativa de atención firmada, OPCIONAL, al cerrar sin atención
 * (Mateo, 2026-10-22). Se sube en el momento; si no hay, alcanza con el
 * motivo escrito. Mismo bucket y misma tabla que la orden (`tipo = negativa`).
 */
export function NegativaFirmada({ emergencyId }) {
  const [negativa, setNegativa] = useState(null)
  const [vista, setVista] = useState(null)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')
  const [ultimoArchivo, setUltimoArchivo] = useState(null)
  const camara = useRef(null)
  const galeria = useRef(null)
  const [esTactil] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches)

  useEffect(() => {
    let vivo = true
    ordenTrasladoService.listar(emergencyId)
      .then(async lista => {
        const ultima = ultimosPorTipo(lista).negativa
        if (!vivo || !ultima) return
        setNegativa(ultima)
        const url = await ordenTrasladoService.urlFoto(ultima.fotoPath).catch(() => null)
        if (vivo && url) setVista(url)
      })
      .catch(() => {})
    return () => { vivo = false }
  }, [emergencyId])

  async function subir(file) {
    if (!file) return
    setUltimoArchivo(file)
    setSubiendo(true)
    setError('')
    try {
      const doc = await ordenTrasladoService.subir(emergencyId, file, { tipo: 'negativa' })
      setVista(URL.createObjectURL(file))
      setNegativa(doc)
    } catch (e) {
      setError(e?.message || 'No pudimos subir la foto.')
    } finally {
      setSubiendo(false)
      if (camara.current) camara.current.value = ''
      if (galeria.current) galeria.current.value = ''
    }
  }

  return (
    <div className="space-y-2" data-testid="negativa-firmada">
      <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => subir(e.target.files?.[0])} />
      <input ref={galeria} type="file" accept={TIPOS_FOTO_ORDEN.join(',')} className="hidden" onChange={e => subir(e.target.files?.[0])} />
      {negativa ? (
        <div className="flex items-center gap-3">
          <span className="w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-bg-surface border border-border-default">
            {vista && <img src={vista} alt="Negativa firmada" className="w-full h-full object-cover" />}
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-text-primary tabular-nums">Negativa subida · {horaDeOrden(negativa.subidaAt)}</p>
            <button type="button" className="text-sm font-semibold text-text-primary underline" onClick={() => (esTactil ? camara : galeria).current?.click()}>
              Cambiar foto
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            disabled={subiendo}
            onClick={() => (esTactil ? camara : galeria).current?.click()}
            className="w-full min-h-14 rounded-[24px] border border-border-default bg-white text-text-primary font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {subiendo
              ? <><CircleNotch className="h-5 w-5 animate-spin" /> Subiendo…</>
              : <><Camera className="h-5 w-5" /> Agregar foto de la negativa firmada <span className="text-text-tertiary font-normal">Opcional</span></>}
          </button>
          {esTactil && (
            <button type="button" disabled={subiendo} onClick={() => galeria.current?.click()} className="w-full text-sm font-semibold text-text-primary underline disabled:opacity-40">
              Elegir de fotos
            </button>
          )}
          <p className="text-sm text-text-secondary">Si el paciente firmó la negativa, sumala. Si no, alcanza con el motivo.</p>
        </>
      )}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-danger/5 text-sm text-danger" role="alert">
          <WarningCircle className="h-5 w-5 shrink-0" />
          <span className="flex-1">{error}</span>
          {ultimoArchivo && <button type="button" className="font-semibold underline" onClick={() => subir(ultimoArchivo)}>Reintentar</button>}
        </div>
      )}
    </div>
  )
}
