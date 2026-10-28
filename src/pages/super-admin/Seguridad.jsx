import { useState, useEffect, useCallback } from 'react'
import { ShieldCheck, Copy } from '@phosphor-icons/react'
import { toast } from '../../components/Toast'
import { mfaService } from '../../services/mfaService'
import { MFA_SUPERADMIN_OBLIGATORIO, limpiarCodigo } from '../../lib/mfa'

/**
 * Segundo factor (TOTP) del super admin. SIN link en el menú a propósito
 * (decisión de Mateo, 2026-10-28): se entra por /super-admin/seguridad. Ver
 * `lib/mfa.js` y docs/mfa-superadmin.md.
 */
export default function SuperAdminSeguridad() {
  const [estado, setEstado] = useState(null)
  const [alta, setAlta] = useState(null) // { factorId, qr, secreto } mientras se da de alta
  const [codigo, setCodigo] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [confirmandoBaja, setConfirmandoBaja] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setEstado(await mfaService.estado())
    } catch (err) {
      toast.error(err.message)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const empezar = async () => {
    setTrabajando(true)
    try {
      setAlta(await mfaService.iniciarAlta())
      setCodigo('')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setTrabajando(false)
    }
  }

  const cancelar = async () => {
    const { factorId } = alta
    setAlta(null)
    try { await mfaService.cancelarAlta(factorId) } catch (err) { toast.error(err.message) }
    cargar()
  }

  const confirmar = async (e) => {
    e.preventDefault()
    if (codigo.length !== 6) return
    setTrabajando(true)
    try {
      await mfaService.confirmarAlta(alta.factorId, codigo)
      toast.success('Segundo factor activado')
      setAlta(null)
      setCodigo('')
      await cargar()
    } catch (err) {
      toast.error(err.message)
      setCodigo('')
    } finally {
      setTrabajando(false)
    }
  }

  const darDeBaja = async (factorId) => {
    setTrabajando(true)
    try {
      await mfaService.darDeBaja(factorId)
      toast.success('Segundo factor dado de baja')
      setConfirmandoBaja(false)
      await cargar()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setTrabajando(false)
    }
  }

  const copiarSecreto = async () => {
    try {
      await navigator.clipboard.writeText(alta.secreto)
      toast.success('Secreto copiado')
    } catch {
      toast.error('No pudimos copiarlo — seleccionalo a mano')
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Seguridad</h1>
        <p className="text-text-secondary mt-1">Verificación en dos pasos con una app de códigos (Google Authenticator, 1Password, Authy).</p>
      </div>

      {!estado ? (
        <div className="h-32 bg-bg-surface rounded-xl animate-pulse" />
      ) : estado.tieneFactor ? (
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-brand" />
            <h2 className="font-semibold text-text-primary">Segundo factor activo</h2>
          </div>
          <p className="text-sm text-text-secondary">
            Al iniciar sesión te pedimos el código de 6 dígitos después de la contraseña.
          </p>
          <ul className="text-sm text-text-secondary space-y-1">
            {estado.verificados.map(f => (
              <li key={f.id}>{f.friendly_name || 'App de códigos'} · alta {new Date(f.created_at).toLocaleDateString('es-AR')}</li>
            ))}
          </ul>
          {confirmandoBaja ? (
            <div className="space-y-2">
              <p className="text-sm text-text-primary">¿Dar de baja el segundo factor? Vas a volver a entrar sólo con la contraseña.</p>
              <div className="flex gap-2">
                <button type="button" disabled={trabajando} className="btn-danger px-4 py-2" onClick={() => darDeBaja(estado.verificados[0].id)}>
                  {trabajando ? 'Dando de baja...' : 'Dar de baja'}
                </button>
                <button type="button" className="btn-secondary px-4 py-2" onClick={() => setConfirmandoBaja(false)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-secondary px-4 py-2" onClick={() => setConfirmandoBaja(true)}>Dar de baja</button>
          )}
        </div>
      ) : alta ? (
        <form onSubmit={confirmar} className="card space-y-4">
          <h2 className="font-semibold text-text-primary">Escaneá el código QR</h2>
          <p className="text-sm text-text-secondary">Abrí tu app de códigos, agregá una cuenta nueva y escaneá esto. Después ingresá el primer código que te muestre.</p>
          <img src={alta.qr} alt="Código QR para la app de autenticación" className="w-48 h-48 mx-auto bg-white rounded-xl p-2" />
          <div>
            <p className="form-label">¿No podés escanear? Ingresá este secreto a mano</p>
            <div className="flex items-center gap-2">
              <code data-testid="mfa-secreto" className="flex-1 break-all text-sm bg-bg-surface rounded-lg px-3 py-2">{alta.secreto}</code>
              <button type="button" aria-label="Copiar secreto" className="btn-secondary p-2" onClick={copiarSecreto}><Copy className="h-4 w-4" /></button>
            </div>
          </div>
          <div>
            <label className="form-label" htmlFor="mfa-alta-codigo">Código de 6 dígitos</label>
            <input
              id="mfa-alta-codigo"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              value={codigo}
              onChange={e => setCodigo(limpiarCodigo(e.target.value))}
              placeholder="000000"
              className="form-input text-center tracking-[0.5em] text-lg"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={trabajando || codigo.length !== 6} className="btn-primary px-4 py-2">
              {trabajando ? 'Verificando...' : 'Activar'}
            </button>
            <button type="button" className="btn-secondary px-4 py-2" onClick={cancelar}>Cancelar</button>
          </div>
        </form>
      ) : (
        <div className="card space-y-4">
          <h2 className="font-semibold text-text-primary">Segundo factor desactivado</h2>
          {MFA_SUPERADMIN_OBLIGATORIO && (
            <p className="text-sm text-text-primary">Para usar el panel necesitás activar el segundo factor.</p>
          )}
          <p className="text-sm text-text-secondary">Sumá una capa más a tu cuenta: además de la contraseña, te vamos a pedir un código de tu celular.</p>
          <button type="button" disabled={trabajando} className="btn-primary px-4 py-2" onClick={empezar}>
            {trabajando ? 'Preparando...' : 'Activar segundo factor'}
          </button>
        </div>
      )}
    </div>
  )
}
