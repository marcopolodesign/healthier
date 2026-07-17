import { useState } from 'react'
import { CaretDown, WhatsappLogo, Wrench } from '@phosphor-icons/react'
import { supportWhatsAppLink } from '../../lib/support'

const FAQ_ITEMS = [
  {
    q: '¿Cuánto tarda la verificación de mi perfil?',
    a: 'Entre 24 y 48 horas hábiles desde que enviás tu perfil. Te vamos a notificar cuando esté aprobado — mientras tanto podés seguir completando tu perfil desde el Dashboard.',
  },
  {
    q: '¿Tengo que subir todos los documentos antes de enviar mi perfil?',
    a: 'No. Podés enviar tu perfil y subir los documentos que te falten más adelante desde "Corregir y reenviar". Eso sí, la verificación final requiere que estén todos los documentos requeridos.',
  },
  {
    q: '¿Dónde configuro mis precios y horarios de atención?',
    a: 'En Configuración, pestaña "Tarifas" (precio por modalidad y tipos de consulta con precio propio) y pestaña "Horarios" (tus franjas de disponibilidad, que se dividen automáticamente en turnos de 15 minutos).',
  },
  {
    q: '¿Qué es la Historia Clínica IA?',
    a: 'Es el asistente que graba la consulta, arma la historia clínica estructurada sola, y te deja corregirla por voz o texto antes de guardarla. Nunca guardamos el audio — solo la transcripción y el resumen final quedan en la historia clínica del paciente.',
  },
  {
    q: '¿Cómo cobro mis consultas?',
    a: 'A través de MercadoPago, integrado en la plataforma. Podés ver el resumen de tus ingresos en la sección Ganancias.',
  },
  {
    q: '¿Qué pasa si rechazan mi perfil?',
    a: 'Vas a ver el motivo del rechazo en tu Dashboard, con un botón para corregir y reenviar la información solicitada.',
  },
  {
    q: '¿Puedo atender solo de forma virtual, o solo presencial?',
    a: 'Sí — en tu perfil elegís la modalidad de atención (solo virtual, solo presencial, o ambas) y eso se refleja en cómo te encuentran los pacientes.',
  },
]

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="font-medium text-text-primary">{q}</span>
        <CaretDown className={`h-4 w-4 text-text-tertiary shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <p className="px-5 pb-4 text-sm text-text-secondary leading-relaxed">{a}</p>
      )}
    </div>
  )
}

export default function Ayuda() {
  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="page-title-lg text-text-primary">Centro de ayuda</h1>
        <p className="text-text-secondary mt-1">Preguntas frecuentes y contacto directo con nuestro equipo.</p>
      </div>

      <div className="card bg-brand-muted border-brand/20 flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-white flex items-center justify-center shrink-0">
            <WhatsappLogo weight="fill" className="h-5 w-5 text-brand" />
          </div>
          <div>
            <p className="font-semibold text-text-primary">¿No encontrás lo que buscás?</p>
            <p className="text-sm text-text-secondary">Escribinos por WhatsApp, te respondemos directamente.</p>
          </div>
        </div>
        <a
          href={supportWhatsAppLink('Hola, soy profesional en Healthier y necesito ayuda con:')}
          target="_blank"
          rel="noreferrer"
          className="btn-primary shrink-0 inline-flex items-center gap-2"
        >
          <WhatsappLogo weight="fill" className="h-4 w-4" /> Escribir por WhatsApp
        </a>
      </div>

      <div className="space-y-2">
        {FAQ_ITEMS.map(item => <FaqItem key={item.q} {...item} />)}
      </div>

      <div className="card flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-bg-surface flex items-center justify-center shrink-0">
          <Wrench className="h-5 w-5 text-text-secondary" />
        </div>
        <div>
          <p className="font-semibold text-text-primary text-sm">Soporte técnico (Marco Polo)</p>
          <p className="text-xs text-text-secondary">
            Para problemas técnicos con la plataforma, contactanos por el mismo{' '}
            <a href={supportWhatsAppLink('Hola, tengo un problema técnico con la plataforma Healthier:')} target="_blank" rel="noreferrer" className="text-brand font-medium underline">
              WhatsApp de soporte
            </a>.
          </p>
        </div>
      </div>
    </div>
  )
}
