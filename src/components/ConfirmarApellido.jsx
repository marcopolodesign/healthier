import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { profilesService } from '../services/profilesService'
import { authService } from '../services/authService'
import { toast } from './Toast'
import { marcarPasoBloqueante } from '../lib/pasoBloqueante'
import NombreApellidoInputs from './common/NombreApellidoInputs'
import {
  necesitaApellido, nombreApellidoDe, validarNombreApellido, nombreNormalizado, armarNombreCompleto,
} from '../lib/nombreApellido'

// Sólo dentro del área de cada rol: la landing, los términos y el cambio de
// contraseña no se bloquean.
const AREAS = ['/paciente', '/profesional']

/**
 * Paso bloqueante para quien ya tenía cuenta sin el apellido por separado
 * (migración 183). Aparece una sola vez, la próxima vez que entra, con el
 * nombre que tenía cargado ya partido como PROPUESTA — la persona la confirma
 * o la corrige. No rehace el onboarding: es este único dato.
 *
 * Espejado en `mobile/app/confirmar-apellido.tsx`.
 */
export default function ConfirmarApellido({ profile, onProfileUpdate }) {
  const location = useLocation()
  const [provider, setProvider] = useState(undefined)
  const [nombres, setNombres] = useState({ nombre: '', apellido: '' })
  const [guardando, setGuardando] = useState(false)

  // Sign in with Apple no se pide (ver `necesitaApellido`). El provider sale de
  // la sesión local, sin red.
  useEffect(() => {
    let vivo = true
    authService.getProvider().then(p => { if (vivo) setProvider(p) })
    return () => { vivo = false }
  }, [profile?.id])

  const enArea = AREAS.some(a => location.pathname.startsWith(a))
  const visible = enArea && provider !== undefined && necesitaApellido(profile, provider)

  useEffect(() => {
    if (visible) setNombres(nombreApellidoDe(profile))
    // Se precarga una vez por perfil: lo que la persona tipea no se pisa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, profile?.id])

  useEffect(() => {
    marcarPasoBloqueante(visible)
    return () => marcarPasoBloqueante(false)
  }, [visible])

  if (!visible) return null

  const esProfesional = profile.role === 'professional'
  const cambiaIdentidad = esProfesional &&
    nombreNormalizado(armarNombreCompleto(nombres.nombre, nombres.apellido)) !== nombreNormalizado(profile.fullName)

  const confirmar = async (e) => {
    e.preventDefault()
    const error = validarNombreApellido(nombres.nombre, nombres.apellido)
    if (error) { toast.error(error); return }
    setGuardando(true)
    try {
      const guardado = await profilesService.update(profile.id, {
        first_name: nombres.nombre.trim(),
        last_name: nombres.apellido.trim(),
      })
      onProfileUpdate(guardado)
      toast.success('Listo, guardamos tu nombre y apellido')
    } catch (err) {
      toast.error(`No pudimos guardar tu apellido: ${err.message}`)
    } finally {
      setGuardando(false)
    }
  }

  const salir = async () => {
    await authService.logout()
    window.location.assign('/login')
  }

  return (
    <div className="fixed inset-0 z-[200] bg-bg-primary overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="confirmar-apellido-titulo">
      <div className="min-h-full flex items-center justify-center px-4 py-10">
        <form onSubmit={confirmar} className="card w-full max-w-md space-y-5">
          <div className="text-center">
            <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-2">Un dato más</p>
            <h1 id="confirmar-apellido-titulo" className="text-3xl font-light tracking-tight text-text-primary mb-2">
              Confirmá tu nombre y apellido
            </h1>
            <p className="text-text-secondary text-sm">
              {esProfesional
                ? 'Los necesitamos por separado: así salen en las recetas que emitas.'
                : 'Los necesitamos por separado: así salen en tus recetas.'}
            </p>
          </div>

          <p className="text-xs text-text-secondary bg-bg-secondary border border-border-default rounded-lg px-3 py-2">
            Lo completamos con el nombre que tenías cargado. Revisá que el apellido esté bien antes de seguir.
          </p>

          <NombreApellidoInputs nombre={nombres.nombre} apellido={nombres.apellido} onChange={setNombres} autoFocus />

          {cambiaIdentidad && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Cambiaste alguna palabra de tu nombre. Si tu perfil ya estaba verificado, va a volver a revisión.
            </p>
          )}

          <button type="submit" disabled={guardando} className="btn-primary w-full py-2.5 disabled:opacity-40 disabled:cursor-not-allowed">
            {guardando ? 'Guardando...' : 'Confirmar'}
          </button>
          <button type="button" onClick={salir} className="w-full text-center text-sm text-text-tertiary hover:text-text-primary">
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  )
}
