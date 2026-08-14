import { Navigate, useLocation } from 'react-router-dom'
import { faltanDatosPaciente } from '../../lib/datosReceta'

/**
 * Guard de ruta: sin los datos que la receta electrónica exige, no se reserva.
 *
 * Va en la ruta y no en cada botón a propósito. "Consultar" se dispara desde el
 * dashboard, el buscador, el perfil del profesional, el resumen de salud, la
 * pantalla de turno confirmado y los deep links — poner el chequeo en cada uno
 * es garantizar que el próximo que se agregue no lo tenga.
 *
 * El corte es exactamente el de `lib/datosReceta` (DNI, sexo, fecha de
 * nacimiento), que salió de probar contra el sandbox quitando un campo por vez.
 * No es "perfil completo": pedir más que eso frenaría reservas que hoy funcionan.
 *
 * Por qué antes de reservar y no antes de emitir la receta: cuando el
 * profesional descubre que falta el DNI ya tiene al paciente en la llamada, y
 * ahí el dato o se pide a las apuradas o la consulta termina sin receta. El
 * cartel de `DatosRecetaFaltantes` prometía "se lo pedimos automáticamente la
 * próxima vez que entre a una consulta" — esto es esa promesa.
 */
export default function RequireDatosReceta({ profile, children }) {
  const location = useLocation()

  // Mientras el perfil no cargó no se decide nada: redirigir acá mandaría a
  // completar datos a alguien que sí los tiene.
  if (!profile) return children

  const faltan = faltanDatosPaciente(profile)
  if (faltan.length === 0) return children

  const volverA = `${location.pathname}${location.search}`
  return <Navigate to={`/paciente/completar-datos?volverA=${encodeURIComponent(volverA)}`} replace />
}
