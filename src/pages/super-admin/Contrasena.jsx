import { useState } from 'react'
import { toast } from '../../components/Toast'
import NuevaContrasenaForm, { MIN_CONTRASENA } from '../../components/auth/NuevaContrasenaForm'
import { authService } from '../../services/authService'

/**
 * Poner o cambiar la contraseña propia del super admin (Mateo, 2026-10-29).
 * Sirve también para quien entró siempre por magic link y nunca tuvo una:
 * `updateUser({ password })` la crea. La validación (largo, repetirla) y el
 * error real viven en `NuevaContrasenaForm`, el mismo del "olvidé mi
 * contraseña". La pantalla del segundo factor es otra (/super-admin/seguridad).
 * Diseño revisado por Felipe: sin font-bold en el h1 (Everett), una sola línea
 * de ayuda, formulario angosto y sin autofoco (no abrir el teclado en el teléfono).
 */
export default function SuperAdminContrasena() {
  // Al guardar se remonta el formulario: vacía los dos campos y vuelve a ocultar la contraseña.
  const [version, setVersion] = useState(0)

  const guardar = async (password) => {
    await authService.updatePassword(password)
    toast.success('Contraseña guardada')
    setVersion(v => v + 1)
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl text-text-primary">Mi contraseña</h1>
        <p className="text-text-secondary mt-1">Para entrar con tu mail, sin esperar el enlace.</p>
      </div>

      <div className="card">
        <div className="max-w-sm">
          <NuevaContrasenaForm
            key={version}
            onSubmit={guardar}
            boton="Guardar contraseña"
            botonCargando="Guardando..."
            autoFocus={false}
            placeholderNueva={`Al menos ${MIN_CONTRASENA} caracteres`}
          />
        </div>
      </div>
    </div>
  )
}
