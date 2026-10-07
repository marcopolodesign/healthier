import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { authService } from '../../services/authService'
import { bajaService } from '../../services/bajaService'
import { ROLE_REDIRECTS } from '../../lib/roleRedirects'
import NuevaContrasenaForm from '../../components/auth/NuevaContrasenaForm'

// A acá llega el link del mail "Recuperá tu cuenta" (migración 188): alguien
// que fue dado de baja se quiso registrar de nuevo con el mismo mail y eligió
// recuperar la cuenta vieja, con su historia clínica. Elige una contraseña
// nueva, `reactivar-cuenta` le devuelve el acceso y entra directo.

export default function ReactivarCuenta({ onLogin }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''
  const [destino, setDestino] = useState(null)

  const recuperar = async (password) => {
    const email = await bajaService.confirmarReactivacion(token, password)
    const { profile } = await authService.login(email, password)
    onLogin?.(profile)
    setDestino(ROLE_REDIRECTS[profile?.role] || '/')
  }

  if (!token) {
    return (
      <div className="card text-center">
        <WarningCircle weight="fill" className="h-12 w-12 text-brand-secondary mx-auto mb-4" />
        <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-text-primary mb-3">Falta el link del mail</h1>
        <p className="text-text-secondary text-sm mb-6">Abrí esta página desde el botón del mail “Recuperá tu cuenta”.</p>
        <Link to="/registro" className="btn-primary w-full py-2.5 inline-block">Volver al registro</Link>
      </div>
    )
  }

  if (destino) {
    return (
      <div className="card text-center">
        <CheckCircle weight="fill" className="h-12 w-12 text-brand mx-auto mb-4" />
        <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-text-primary mb-3">Recuperaste tu cuenta</h1>
        <p className="text-text-secondary text-sm mb-6">Tu historial y tu historia clínica siguen ahí, como los dejaste.</p>
        <button type="button" onClick={() => navigate(destino, { replace: true })} className="btn-primary w-full py-2.5">
          Ir a mi inicio
        </button>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="text-center mb-8">
        <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-2">Recuperar cuenta</p>
        <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-text-primary mb-1">Elegí tu contraseña</h1>
        <p className="text-text-secondary text-sm">Con esto vuelve tu cuenta, con tu historial e historia clínica.</p>
      </div>

      <NuevaContrasenaForm onSubmit={recuperar} boton="Recuperar mi cuenta" botonCargando="Recuperando..." />
    </div>
  )
}
