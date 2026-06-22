import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from '@phosphor-icons/react'

const LAST_UPDATED = '22 de junio de 2026'

const Section = ({ title, children }) => (
  <section className="mb-10">
    <h2 className="text-xl font-semibold text-text-primary mb-3">{title}</h2>
    <div className="text-text-secondary leading-relaxed space-y-3">{children}</div>
  </section>
)

export default function TerminosYCondiciones() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-8 transition-colors"
        >
          <ArrowLeft size={16} />
          Volver
        </button>

        <h1 className="text-3xl font-semibold text-text-primary mb-2">
          Términos y Condiciones
        </h1>
        <p className="text-sm text-text-secondary mb-10">Última actualización: {LAST_UPDATED}</p>

        <Section title="1. Aceptación">
          <p>
            Al crear una cuenta en Healthier, el usuario acepta estos Términos y Condiciones en su
            totalidad. Si no estás de acuerdo con alguna de las condiciones, no debes utilizar la
            plataforma.
          </p>
        </Section>

        <Section title="2. Descripción del servicio">
          <p>
            Healthier es una plataforma digital de salud que conecta pacientes con profesionales de
            la salud en Buenos Aires, Argentina. Facilitamos reservas de consultas (presenciales y
            por videollamada), almacenamiento de historial clínico y comunicación entre pacientes y
            profesionales autorizados.
          </p>
        </Section>

        <Section title="3. Datos de salud y acceso del equipo médico">
          <p>
            Al registrarte como paciente aceptás expresamente que los profesionales de salud que te
            atiendan a través de Healthier puedan acceder a tu información clínica compartida. Este
            acceso está limitado al <strong>equipo tratante</strong>: los profesionales con quienes
            hayas iniciado o tengas una consulta activa.
          </p>
          <p>
            El acceso del equipo tratante comprende:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Historial de consultas previas realizadas en Healthier</li>
            <li>Diagnósticos, condiciones y alergias registradas en la plataforma</li>
            <li>Medicamentos activos y recetas emitidas en la plataforma</li>
            <li>Notas clínicas externas (visibles al paciente según Ley 26.529, Art. 15)</li>
          </ul>
          <p>
            Este mecanismo de acceso compartido tiene como finalidad garantizar una atención
            integral y coordinada, en cumplimiento del Art. 2 inc. d) de la Ley 26.529 (derechos
            del paciente en la relación con los profesionales e instituciones de la salud).
          </p>
          <p>
            Los profesionales <strong>no</strong> pueden acceder a documentos almacenados en tu
            Bóveda de documentos privados, ni a datos de salud de wearables u otras fuentes externas,
            salvo que los compartas explícitamente durante una consulta.
          </p>
        </Section>

        <Section title="4. Protección de datos personales — Ley 25.326">
          <p>
            Healthier trata los datos personales de sus usuarios en cumplimiento de la Ley N° 25.326
            de Protección de Datos Personales y sus normas complementarias.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Responsable del tratamiento:</strong> Healthier (plataforma operada bajo
              Marco Polo Design).
            </li>
            <li>
              <strong>Finalidad:</strong> Prestación de servicios de salud digitales, gestión de
              consultas, historial clínico y comunicaciones relacionadas.
            </li>
            <li>
              <strong>Almacenamiento:</strong> Tus datos se almacenan en servidores de Amazon Web
              Services ubicados en São Paulo, Brasil, con cifrado AES-256 en reposo y TLS en
              tránsito.
            </li>
            <li>
              <strong>Derechos ARCO:</strong> Podés ejercer tus derechos de Acceso, Rectificación,
              Cancelación u Oposición contactándonos en{' '}
              <a href="mailto:privacidad@gethealthier.app" className="text-brand hover:underline">
                privacidad@gethealthier.app
              </a>.
            </li>
            <li>
              <strong>Plazo de conservación:</strong> Los datos clínicos se conservan por un mínimo
              de 10 años desde la última consulta, en cumplimiento de la Ley 26.529.
            </li>
          </ul>
          <p>
            La base de datos de usuarios de Healthier está en proceso de inscripción ante el
            Registro Nacional de Bases de Datos (RNBD) de la AAIP, en cumplimiento del Art. 21 de
            la Ley 25.326.
          </p>
        </Section>

        <Section title="5. Datos de salud sensibles">
          <p>
            Los datos de salud constituyen datos sensibles según el Art. 2 de la Ley 25.326. Su
            tratamiento requiere consentimiento expreso e informado del titular, el cual se obtiene
            durante el proceso de registro. El usuario puede revocar su consentimiento en cualquier
            momento, lo que implicará la baja del servicio y la anonimización de sus datos clínicos.
          </p>
        </Section>

        <Section title="6. Responsabilidad de los profesionales">
          <p>
            Los profesionales de salud registrados en Healthier son responsables del contenido
            clínico que generan (diagnósticos, prescripciones, indicaciones). Healthier actúa como
            plataforma intermediaria y no es responsable de los actos médicos realizados a través de
            ella.
          </p>
          <p>
            Todos los profesionales deben acreditar matrícula habilitante (MN o MP) al registrarse.
            Healthier verifica la documentación antes de habilitar el perfil.
          </p>
        </Section>

        <Section title="7. Consultas por videollamada">
          <p>
            Las consultas por videollamada son actos médicos a distancia válidos en Argentina
            conforme a la Ley 27.553 (Teleconsulta). El paciente y el profesional deben estar
            presentes en tiempo real. Las sesiones no son grabadas por Healthier.
          </p>
        </Section>

        <Section title="8. Modificaciones">
          <p>
            Healthier puede modificar estos Términos y Condiciones. Los cambios materiales serán
            notificados con al menos 15 días de anticipación por correo electrónico. El uso
            continuado de la plataforma tras la notificación implica la aceptación de los nuevos
            términos.
          </p>
        </Section>

        <Section title="9. Contacto y consultas legales">
          <p>
            Para consultas sobre estos términos, privacidad o ejercicio de derechos ARCO:
          </p>
          <p>
            <a href="mailto:legal@gethealthier.app" className="text-brand hover:underline">
              legal@gethealthier.app
            </a>
          </p>
        </Section>

        <div className="border-t border-border-default pt-6 text-xs text-text-secondary">
          Versión 1.0 — {LAST_UPDATED}. Ley 26.529 · Ley 25.326 · Ley 27.553.
        </div>
      </div>
    </div>
  )
}
