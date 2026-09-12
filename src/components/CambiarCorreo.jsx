import { useEffect, useState } from 'react'
import { Envelope, ShieldCheck } from '@phosphor-icons/react'
import { emailChangeService } from '../services/emailChangeService'
import { toast } from './Toast'

/**
 * Cambiar el correo de acceso. Son dos códigos —uno a la dirección actual y
 * otro a la nueva— y hacen falta los dos.
 *
 * El del correo **actual** es el que importa: sin él, cambiar de correo sería
 * una forma de pasarle la cuenta a otra persona (migración 156).
 *
 * Mientras el cambio no se verifica no pasa nada: se sigue entrando con el
 * correo de siempre y el pedido vence solo a los 30 minutos.
 */
export default function CambiarCorreo({ emailActual, onCambiado }) {
  const [paso, setPaso] = useState('quieto')   // quieto | pidiendo | codigos
  const [nuevoEmail, setNuevoEmail] = useState('')
  const [codActual, setCodActual] = useState('')
  const [codNuevo, setCodNuevo] = useState('')
  const [cargando, setCargando] = useState(false)

  // Un pedido a medias sobrevive a recargar la página: si no se retoma acá, el
  // profesional se queda con dos códigos en el mail y ninguna pantalla donde
  // escribirlos.
  useEffect(() => {
    emailChangeService.estado()
      .then(e => { if (e?.pendiente) { setNuevoEmail(e.nuevoEmail); setPaso('codigos') } })
      .catch(() => {})
  }, [])

  const solicitar = async () => {
    setCargando(true)
    try {
      await emailChangeService.solicitar(nuevoEmail.trim())
      setPaso('codigos')
      toast.success('Te mandamos un código a cada dirección')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCargando(false)
    }
  }

  const verificar = async () => {
    setCargando(true)
    try {
      const r = await emailChangeService.verificar(codActual.trim(), codNuevo.trim())
      if (!r.ok) {
        toast.error(
          r.motivo === 'demasiados_intentos' ? 'Se agotaron los intentos. Pedí el cambio de nuevo.'
          : r.motivo === 'sin_pedido' ? 'El pedido venció. Empezá de nuevo.'
          : `Alguno de los dos códigos no coincide. Quedan ${r.intentosRestantes} intento(s).`
        )
        if (r.motivo !== 'codigo_incorrecto') reset()
        return
      }
      toast.success('Listo, tu correo de acceso cambió')
      reset()
      onCambiado?.(r.email)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCargando(false)
    }
  }

  const reset = () => {
    setPaso('quieto'); setNuevoEmail(''); setCodActual(''); setCodNuevo('')
  }

  const cancelar = async () => {
    await emailChangeService.cancelar().catch(() => {})
    reset()
  }

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-semibold text-text-primary">Correo de acceso</h2>
        <p className="text-sm text-text-secondary mt-0.5">
          Es con el que entrás y al que te llega todo. Hoy es <strong>{emailActual}</strong>.
        </p>
      </div>

      {paso === 'quieto' && (
        <button type="button" className="btn-secondary" onClick={() => setPaso('pidiendo')}>
          Cambiar mi correo
        </button>
      )}

      {paso === 'pidiendo' && (
        <div className="space-y-3">
          <div>
            <label className="form-label">Correo nuevo</label>
            <input
              type="email"
              className="form-input"
              value={nuevoEmail}
              onChange={e => setNuevoEmail(e.target.value)}
              placeholder="tu@correo.com"
            />
          </div>
          <p className="text-xs text-text-secondary flex items-start gap-1.5">
            <ShieldCheck className="h-4 w-4 shrink-0 mt-px" />
            Vamos a mandar un código a <strong>cada</strong> dirección: a esta nueva y a la actual.
            Hacen falta los dos, y es lo que evita que alguien más se quede con tu cuenta.
          </p>
          <div className="flex gap-3">
            <button
              type="button" className="btn-primary"
              disabled={cargando || !nuevoEmail.trim()}
              onClick={solicitar}
            >
              {cargando ? 'Enviando...' : 'Enviarme los códigos'}
            </button>
            <button type="button" className="btn-secondary" onClick={reset}>Volver</button>
          </div>
        </div>
      )}

      {paso === 'codigos' && (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary flex items-start gap-1.5">
            <Envelope className="h-4 w-4 shrink-0 mt-0.5" />
            Mandamos un código a <strong>{emailActual}</strong> y otro a <strong>{nuevoEmail}</strong>.
            Vencen en 30 minutos.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="form-label">Código que llegó a {emailActual}</label>
              <input
                className="form-input text-center text-xl tracking-[0.3em] font-mono"
                inputMode="numeric" maxLength={6}
                value={codActual}
                onChange={e => setCodActual(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="------"
              />
            </div>
            <div>
              <label className="form-label">Código que llegó a {nuevoEmail}</label>
              <input
                className="form-input text-center text-xl tracking-[0.3em] font-mono"
                inputMode="numeric" maxLength={6}
                value={codNuevo}
                onChange={e => setCodNuevo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="------"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="button" className="btn-primary"
              disabled={cargando || codActual.length !== 6 || codNuevo.length !== 6}
              onClick={verificar}
            >
              {cargando ? 'Verificando...' : 'Confirmar el cambio'}
            </button>
            <button type="button" className="btn-secondary" onClick={cancelar}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
