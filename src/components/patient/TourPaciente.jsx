import { useTourGuiado } from '../../hooks/useTourGuiado'

/**
 * El tour que explica la plataforma desde el lado del paciente, sobre su inicio
 * (`/paciente/dashboard`).
 *
 * El motor está en `useTourGuiado`, compartido con el tour del profesional y con
 * la guía de la simulación de videollamada.
 *
 * ── Un solo recorrido para teléfono y escritorio ────────────────────────────
 *
 * El inicio del paciente es una sola columna que scrollea, igual en los dos
 * tamaños — ya no hay hoja arrastrable ni panel flotante. Lo único que cambia es
 * la barra de abajo, que en escritorio es una píldora centrada
 * (`PatientMobileLayout`), pero son los MISMOS botones con los mismos
 * `data-tour`. Así que un solo juego de pasos alcanza, y no hay que mantener dos.
 *
 * ── Los pasos dependen de lo que esté habilitado ────────────────────────────
 *
 * Un paso que no le corresponde a alguien se saca (`aplica`), no se muestra sin
 * foco: la consulta inmediata sólo existe si hay alguna vertical habilitada (el
 * carrusel se arma con `useVerticales()`, no con una lista del código), y el
 * S.O.S. se puede apagar entero desde `/super-admin/verticales`. Explicar un
 * servicio apagado es prometer algo que no está.
 *
 * Farmacia queda deliberadamente afuera: sus accesos se sacaron el 2026-08-29 y
 * la feature sigue viva pero sin entrada visible — nombrarla mandaría al
 * paciente a buscar algo que no va a encontrar.
 */

export const CLAVE_TOUR_PACIENTE = 'healthier:tour-paciente-visto'

const PASOS = [
  {
    titulo: 'Bienvenido a Healthier',
    cuerpo: 'En un minuto te mostramos cómo pedir una consulta, dónde queda tu historia clínica y qué hacer si es una urgencia.',
  },
  {
    selector: '[data-tour="pac-ondemand"]',
    lado: 'bottom',
    aplica: ({ hayOnDemand }) => hayOnDemand,
    titulo: 'Atención ahora, sin turno',
    cuerpo: 'Elegís la especialidad y te atiende por videollamada el primer profesional disponible, en minutos. El precio está a la vista antes de empezar.',
  },
  {
    selector: '[data-tour="pac-avisos"]',
    lado: 'bottom',
    titulo: 'Tus avisos',
    cuerpo: 'Acá te avisamos cuando se confirma un turno, cuando tenés una receta nueva o cuando se mueve un pedido de farmacia.',
  },
  {
    selector: '[data-tour="pac-mapa"]',
    lado: 'top',
    titulo: 'Los que están cerca',
    cuerpo: 'El mapa te muestra a los profesionales que atienden presencial cerca tuyo, con su especialidad y a qué distancia están.',
  },
  {
    selector: '[data-tour="pac-buscar"]',
    lado: 'top',
    titulo: '¿Te recomendaron a alguien?',
    cuerpo: 'Buscalo por nombre y fijate si está disponible para atenderte ahora mismo.',
  },
  {
    selector: '[data-tour="pac-sos"]',
    lado: 'top',
    aplica: ({ sosActivo }) => sosActivo,
    titulo: 'Si es una emergencia',
    cuerpo: 'El botón rojo pide atención médica de inmediato en tu ubicación. Es para urgencias reales — para todo lo demás, usá una consulta.',
  },
  {
    selector: '[data-tour="pac-nav-agenda"]',
    lado: 'top',
    titulo: 'Tus turnos',
    cuerpo: 'En Turnos agendás con el profesional que prefieras, y ves tus consultas: las que vienen, el link para entrar a la videollamada y las que ya pasaron.',
  },
  {
    selector: '[data-tour="pac-nav-boveda"]',
    lado: 'top',
    titulo: 'Tu bóveda',
    cuerpo: 'Tu historia clínica, tus estudios y tus recetas, todo junto. Lo que cargue un profesional aparece acá, y podés subir vos lo que tengas en papel.',
  },
  {
    selector: '[data-tour="pac-nav-perfil"]',
    lado: 'top',
    titulo: 'Tus datos',
    cuerpo: 'Tu obra social, tus tarjetas guardadas, tu grupo familiar y las notificaciones. Desde acá también podés volver a ver este recorrido cuando quieras.',
  },
]

export default function TourPaciente({ hayOnDemand = false, sosActivo = false, listo = true }) {
  useTourGuiado({
    clave: CLAVE_TOUR_PACIENTE,
    pasos: PASOS,
    ctx: { hayOnDemand, sosActivo },
    listo,
  })
  // No pinta nada: el tour es todo overlay. El punto de entrada para volver a
  // verlo está en Perfil — ver `patient/Profile.jsx`.
  return null
}
