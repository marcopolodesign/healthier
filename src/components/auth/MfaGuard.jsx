import { useState, useEffect, useCallback } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ShieldCheck } from '@phosphor-icons/react'
import { mfaService } from '../../services/mfaService'
import { authService } from '../../services/authService'
import { toast } from '../Toast'
import {
  decidirPasoMfa, PASO_MFA, MFA_SUPERADMIN_OBLIGATORIO, RUTA_SEGURIDAD, EVENTO_MFA_CAMBIO, limpiarCodigo,
} from '../../lib/mfa'

/**
 * Puerta del segundo factor para el super admin (ver `lib/mfa.js`).
 *
 * Envuelve las rutas. Para cualquier rol que no sea `super_admin` no hace nada
 * (ni una llamada a Supabase). Para un super admin:
 *   - con factor TOTP verificado y sesión aal1 → pantalla de los 6 dígitos;
 *   - sin factor y VITE_MFA_SUPERADMIN_OBLIGATORIO=true → sólo puede estar en
 *     /super-admin/seguridad;
 *   - el resto → pasa.
 *
 * El resultado se guarda atado al id del perfil: al cambiar de cuenta se vuelve
 * a evaluar y mientras tanto se muestra un spinner (nunca el panel).
 */
export default function MfaGuard({ profile, children }) {
  const [resultado, setResultado] = useState(null) // { clave, paso } | { clave, error }
  const [reintento, setReintento] = useState(0)
  const location = useLocation()

  const esSuperAdmin = profile?.role === 'super_admin'
  const clave = esSuperAdmin ? profile.id : null

  useEffect(() => {
    if (!clave) return undefined
    let vigente = true
    mfaService.estado()
      .then(e => {
        if (!vigente) return
        setResultado({
          clave,
          paso: decidirPasoMfa({
            role: 'super_admin',
            currentLevel: e.currentLevel,
            tieneFactor: e.tieneFactor,
            obligatorio: MFA_SUPERADMIN_OBLIGATORIO,
          }),
        })
      })
      .catch(err => { if (vigente) setResultado({ clave, error: err.message }) })
    return () => { vigente = false }
  }, [clave, reintento])

  // Alta o baja de un factor desde /super-admin/seguridad → re-evaluar.
  // (sin vaciar el resultado: la pantalla no parpadea mientras se re-evalúa)
  const reevaluar = useCallback(() => setReintento(n => n + 1), [])
  useEffect(() => {
    window.addEventListener(EVENTO_MFA_CAMBIO, reevaluar)
    return () => window.removeEventListener(EVENTO_MFA_CAMBIO, reevaluar)
  }, [reevaluar])

  if (!esSuperAdmin) return children

  const actual = resultado?.clave === clave ? resultado : null

  if (!actual) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (actual.error) {
    return (
      <PantallaMfa titulo="No pudimos verificar tu sesión" subtitulo={actual.error}>
        <button type="button" className="btn-primary w-full py-2.5" onClick={() => { setResultado(null); reevaluar() }}>Reintentar</button>
        <button type="button" className="btn-secondary w-full py-2.5 mt-2" onClick={() => authService.logout()}>Cerrar sesión</button>
      </PantallaMfa>
    )
  }

  if (actual.paso === PASO_MFA.VERIFICAR) {
    return <DesafioMfa onVerificado={() => setResultado({ clave, paso: PASO_MFA.NINGUNO })} />
  }

  if (actual.paso === PASO_MFA.ENROLAR && location.pathname !== RUTA_SEGURIDAD) {
    return <Navigate to={RUTA_SEGURIDAD} replace />
  }

  return children
}

function PantallaMfa({ titulo, subtitulo, children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand/5 via-bg-primary to-brand/10 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md card">
        <div className="text-center mb-6">
          <ShieldCheck className="h-8 w-8 text-brand mx-auto mb-3" />
          <h1 className="text-2xl font-light tracking-tight text-text-primary mb-1">{titulo}</h1>
          {subtitulo && <p className="text-text-secondary text-sm">{subtitulo}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

function DesafioMfa({ onVerificado }) {
  const [codigo, setCodigo] = useState('')
  const [enviando, setEnviando] = useState(false)

  const enviar = async (e) => {
    e.preventDefault()
    if (codigo.length !== 6) return
    setEnviando(true)
    try {
      await mfaService.verificar(codigo)
      onVerificado()
    } catch (err) {
      toast.error(err.message)
      setCodigo('')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <PantallaMfa titulo="Verificación en dos pasos" subtitulo="Ingresá el código de 6 dígitos de tu app de autenticación.">
      <form onSubmit={enviar} className="space-y-4">
        <div>
          <label className="form-label" htmlFor="mfa-codigo">Código</label>
          <input
            id="mfa-codigo"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={6}
            value={codigo}
            onChange={e => setCodigo(limpiarCodigo(e.target.value))}
            placeholder="000000"
            className="form-input text-center tracking-[0.5em] text-lg"
          />
        </div>
        <button type="submit" disabled={enviando || codigo.length !== 6} className="btn-primary w-full py-2.5">
          {enviando ? 'Verificando...' : 'Verificar'}
        </button>
        <button type="button" className="btn-secondary w-full py-2.5" onClick={() => authService.logout()}>
          Cerrar sesión
        </button>
      </form>
    </PantallaMfa>
  )
}
