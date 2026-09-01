import { useTourGuiado } from '../../hooks/useTourGuiado'

/**
 * El tour que explica la plataforma desde el lado del profesional, sobre su
 * propio inicio (`/profesional/dashboard`).
 *
 * El motor está en `useTourGuiado`, compartido con el tour del paciente y con
 * la guía de la simulación de videollamada.
 *
 * ── Son dos recorridos, no uno con pasos escondidos ─────────────────────────
 *
 * `Dashboard.jsx` renderiza **dos árboles de JSX distintos** según el estado:
 * el del profesional que todavía no fue verificado (que ve el estado de su
 * legajo y un checklist para adelantar trabajo) y el del verificado (que ve su
 * agenda, sus ganancias y el switch de consulta inmediata). No comparten casi
 * ningún elemento, así que un tour con pasos condicionales sobre una lista sola
 * sería una lista donde la mitad nunca aplica. Son dos listas.
 *
 * Al no verificado se le explica **qué falta y qué puede ir haciendo mientras
 * espera**; al verificado, **cómo trabaja**. Son dos preguntas distintas.
 *
 * ── Los pasos dependen del estado real ──────────────────────────────────────
 *
 * Un paso que no le corresponde a alguien se saca (`aplica`), no se muestra sin
 * foco: el aviso de Mercado Pago sólo existe si NO lo conectó, NutriPlan Pro
 * sólo está en el menú de nutrición, y la invitación a practicar se puede haber
 * cerrado. Explicar algo que no está en pantalla es peor que no explicarlo.
 */

export const CLAVE_TOUR_PROFESIONAL = 'healthier:tour-profesional-visto'

// ── El que todavía espera la verificación ───────────────────────────────────
const PASOS_SIN_VERIFICAR = [
  {
    titulo: 'Bienvenido a Healthier',
    cuerpo: 'Te contamos en un minuto cómo funciona la plataforma y qué pasa mientras revisamos tu perfil.',
  },
  {
    selector: '[data-tour="pro-checklist"]',
    lado: 'top',
    titulo: 'Adelantá lo que puedas',
    cuerpo: 'Mientras revisamos tu documentación podés dejar listo el resto: tu foto, tus tarifas, tus horarios y la zona donde atendés. Cuando te aprobemos, ya vas a poder recibir pacientes sin más trámites.',
  },
  {
    selector: '[data-tour="pro-practica"]',
    lado: 'top',
    // Puede estar cerrada: la tarjeta se cierra para siempre desde su propia X.
    aplica: ({ practicaVisible }) => practicaVisible,
    titulo: 'Conocé la sala antes de tu primera consulta',
    cuerpo: 'Podés recorrer el panel de videollamada con una paciente de mentira y una guía paso a paso. No se guarda nada, así que probá todo lo que quieras.',
  },
  {
    selector: '[data-tour="nav-configuracion"]',
    lado: 'right',
    titulo: 'Tus tarifas y tus horarios',
    cuerpo: 'En Configuración ponés cuánto sale tu consulta, qué días y horas atendés, y conectás tu Mercado Pago. Sin eso último no vas a poder recibir turnos.',
  },
  {
    titulo: 'Te avisamos por acá',
    cuerpo: 'La verificación suele tardar entre 24 y 48 horas. Cuando esté lista te llega una notificación y esta misma pantalla cambia sola: vas a ver tu agenda.',
  },
]

// ── El que ya trabaja ───────────────────────────────────────────────────────
const PASOS_VERIFICADO = [
  {
    selector: '[data-tour="pro-saludo"]',
    lado: 'bottom',
    titulo: 'Este es tu día',
    cuerpo: 'Acá abajo tenés lo que tenés agendado para hoy. Cuando llegue la hora, entrás a la consulta desde el mismo turno.',
  },
  {
    selector: '[data-tour="pro-ondemand"]',
    lado: 'bottom',
    titulo: 'Consulta inmediata',
    cuerpo: 'Si lo prendés, los pacientes que necesitan atención ahora te pueden llegar directo, sin turno previo. Dura una hora y lo apagás cuando quieras — no hace falta que dejes la app abierta.',
  },
  {
    selector: '[data-tour="pro-mp"]',
    lado: 'bottom',
    // El aviso rojo existe sólo si NO está conectado; el verde, sólo si lo está.
    // El anclaje es el mismo, el texto no puede serlo.
    cuerpo: ({ mpConectado }) => mpConectado
      ? 'Ya está conectado, así que cobrás el 80% de cada consulta directo en tu cuenta de Mercado Pago, en el momento en que el paciente paga. La plata nunca pasa por Healthier.'
      : 'Sin Mercado Pago conectado los pacientes no te pueden reservar. Es el paso que más turnos frena, así que conviene resolverlo primero.',
    titulo: 'Así cobrás',
  },
  {
    selector: '[data-tour="pro-ganancias"]',
    lado: 'top',
    titulo: 'Lo que llevás ganado',
    cuerpo: 'Acá ves lo del mes y, entrando, el desglose consulta por consulta: cuánto cobraste, cuánto se llevó la comisión y en cuántos días se te libera la plata.',
  },
  {
    selector: '[data-tour="pro-referido"]',
    lado: 'top',
    titulo: 'Tu link para tus pacientes',
    cuerpo: 'Mandáselo a los pacientes que ya atendés. Los que entren por ahí quedan asociados a vos y te ven como su médico de cabecera.',
  },
  {
    selector: '[data-tour="nav-nutriplan"]',
    lado: 'right',
    aplica: ({ especialidad }) => especialidad === 'nutricion',
    titulo: 'NutriPlan Pro',
    cuerpo: 'Es tuyo, de nutrición: armás el plan de alimentación de cada paciente y él lo ve desde su app, con el seguimiento de lo que va cumpliendo.',
  },
  {
    selector: '[data-tour="pro-practica"]',
    lado: 'top',
    aplica: ({ practicaVisible }) => practicaVisible,
    titulo: 'Practicá cuando quieras',
    cuerpo: 'Podés recorrer el panel de videollamada con una paciente de mentira, con su propia guía paso a paso. No se guarda nada.',
  },
  {
    selector: '[data-tour="nav-ayuda"]',
    lado: 'right',
    titulo: 'Si algo no se entiende',
    cuerpo: 'En el Centro de ayuda están las preguntas frecuentes, el WhatsApp de soporte y el botón para volver a ver esta guía cuando quieras.',
  },
]

export default function TourProfesional({
  verificado,
  especialidad,
  mpConectado = false,
  practicaVisible = true,
  listo = true,
}) {
  useTourGuiado({
    clave: CLAVE_TOUR_PROFESIONAL,
    pasos: verificado ? PASOS_VERIFICADO : PASOS_SIN_VERIFICAR,
    ctx: { especialidad, mpConectado, practicaVisible },
    listo,
  })
  // No pinta nada: el tour es todo overlay. El punto de entrada para volver a
  // verlo vive en el Centro de ayuda, que es donde el profesional ya busca
  // cuando algo no se entiende — ver `professional/Ayuda.jsx`.
  return null
}
