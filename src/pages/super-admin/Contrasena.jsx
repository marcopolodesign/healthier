import { useState, useEffect, useCallback } from 'react'
import { toast } from '../../components/Toast'
import NuevaContrasenaForm from '../../components/auth/NuevaContrasenaForm'
import { MIN_CONTRASENA } from '../../lib/contrasena'
import { authService } from '../../services/authService'

/**
 * Poner o cambiar la contraseña propia del super admin (Mateo, 2026-10-29).
 * Sirve también para quien entró siempre por magic link y nunca tuvo una:
 * `updateUser({ password })` la crea, sin pedir la actual. Si la cuenta YA tiene
 * contraseña (`tengo_contrasena`, migración 219) se pide la actual y se verifica
 * antes de cambiarla: con una sesión viva no alcanza. Cada cambio queda en el
 * registro de acciones de administradores (`cambio_de_contrasena`).
 * La validación y el error real viven en `NuevaContrasenaForm`. La pantalla del
 * segundo factor es otra (/super-admin/seguridad).
 * Diseño revisado por Felipe: sin font-bold en el h1 (Everett), una sola línea
 * de ayuda, formulario angosto y sin autofoco (no abrir el teclado en el teléfono).
 */
export default function SuperAdminContrasena({ profile }) {
  const [tiene, setTiene] = useState(null)      // null = comprobando
  const [errorCarga, setErrorCarga] = useState('')
  // Al guardar se remonta el formulario: vacía los campos y vuelve a ocultar la contraseña.
  const [version, setVersion] = useState(0)

  const comprobar = useCallback(async () => {
    setErrorCarga('')
    try {
      setTiene(await authService.tengoContrasena())
    } catch (err) {
      setErrorCarga(err.message)
    }
  }, [])

  useEffect(() => { comprobar() }, [comprobar])

  const guardar = async (nueva, actual) => {
    const res = await authService.cambiarContrasenaPropia({ nueva, actual, tieneContrasena: tiene })
    toast.success('Contraseña guardada')
    if (!res.registrado) {
      toast.warning(`La contraseña se guardó, pero no quedó asentada en el registro de acciones: ${res.motivoSinRegistro}`)
    }
    setTiene(true)
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
          {errorCarga ? (
            <div className="space-y-3">
              <p role="alert" className="text-sm text-danger">{errorCarga}</p>
              <button type="button" className="btn-secondary px-4 py-2" onClick={comprobar}>Reintentar</button>
            </div>
          ) : tiene === null ? (
            <div className="h-32 bg-bg-surface rounded-xl animate-pulse" />
          ) : (
            <NuevaContrasenaForm
              key={version}
              onSubmit={guardar}
              boton="Guardar contraseña"
              botonCargando="Guardando..."
              autoFocus={false}
              placeholderNueva={`Al menos ${MIN_CONTRASENA} caracteres`}
              pedirActual={tiene}
              email={profile?.email}
            />
          )}
        </div>
      </div>
    </div>
  )
}
