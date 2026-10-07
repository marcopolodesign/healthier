import { useState } from 'react'
import { Link } from 'react-router-dom'
import { WarningCircle, EnvelopeSimple } from '@phosphor-icons/react'
import { bajaService } from '../../services/bajaService'

/**
 * Qué se le muestra a quien se quiere registrar con un mail que ya existe.
 *
 * - `MAIL_YA_REGISTRADO`: hay una cuenta activa → iniciar sesión o recuperar
 *   la contraseña.
 * - `CUENTA_DADA_DE_BAJA` (migración 188): la cuenta se dio de baja → se le
 *   ofrece recuperarla con su historia clínica (el link llega al mail, así que
 *   sólo la recupera quien tiene esa casilla), o crear una nueva igual.
 */
export default function AvisoMailExistente({ code, email, onCrearNueva }) {
  const [estado, setEstado] = useState('inicial') // inicial | enviando | enviado
  const [error, setError] = useState('')

  if (code === 'MAIL_YA_REGISTRADO') {
    return (
      <div role="alert" className="rounded-xl bg-brand-secondary/10 px-4 py-3 text-sm text-text-primary">
        <p className="flex items-start gap-2">
          <WarningCircle weight="fill" className="h-4 w-4 mt-0.5 shrink-0 text-brand-secondary" />
          <span>Ese mail ya está registrado — iniciá sesión o recuperá la contraseña.</span>
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 pl-6">
          <Link to="/login" className="text-brand font-medium hover:underline">Iniciar sesión</Link>
          <Link to="/recuperar-contrasena" className="text-brand font-medium hover:underline">Recuperar la contraseña</Link>
        </div>
      </div>
    )
  }

  if (code !== 'CUENTA_DADA_DE_BAJA') return null

  const pedir = async () => {
    setError('')
    setEstado('enviando')
    try {
      await bajaService.pedirReactivacion(email)
      setEstado('enviado')
    } catch (err) {
      setError(err.message)
      setEstado('inicial')
    }
  }

  if (estado === 'enviado') {
    return (
      <div role="status" className="rounded-xl bg-brand/10 px-4 py-3 text-sm text-text-primary">
        <p className="flex items-start gap-2">
          <EnvelopeSimple weight="fill" className="h-4 w-4 mt-0.5 shrink-0 text-brand" />
          <span>Te mandamos un mail a <strong>{email}</strong> con el link para recuperar tu cuenta. Vale por una hora.</span>
        </p>
      </div>
    )
  }

  return (
    <div role="alert" className="rounded-xl bg-brand-secondary/10 px-4 py-3 text-sm text-text-primary space-y-3">
      <p className="flex items-start gap-2">
        <WarningCircle weight="fill" className="h-4 w-4 mt-0.5 shrink-0 text-brand-secondary" />
        <span>
          Ese mail tenía una cuenta en Healthier que fue dada de baja. Podés recuperarla con tu historial
          de consultas e historia clínica: te mandamos un link a <strong>{email}</strong>.
        </span>
      </p>
      {error && <p className="text-danger pl-6">{error}</p>}
      <div className="flex flex-col gap-2 pl-6">
        <button type="button" onClick={pedir} disabled={estado === 'enviando'} className="btn-primary w-full py-2.5 disabled:opacity-40">
          {estado === 'enviando' ? 'Enviando...' : 'Recuperar mi cuenta'}
        </button>
        <button type="button" onClick={onCrearNueva} className="text-text-secondary hover:text-text-primary text-sm font-medium py-1">
          Crear una cuenta nueva igual
        </button>
      </div>
    </div>
  )
}
