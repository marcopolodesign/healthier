import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { SealCheck, ArrowRight, HeartStraight } from '@phosphor-icons/react'
import { referralService } from '../services/referralService'
import { storeReferral } from '../lib/referral'
import { track } from '../utils/analytics'
import { CompanyLogo } from '../components/common/CompanyLogo'

const ESPECIALIDAD_LABEL = {
  medicina_general: 'Medicina General',
  pediatria: 'Pediatría',
  nutricion: 'Nutrición',
  psicologia: 'Psicología',
  veterinaria: 'Veterinaria',
}

/**
 * `/r/:codigo` — la puerta de entrada del link que el profesional le manda a sus
 * pacientes de siempre.
 *
 * Es pública a propósito: el paciente que recibe el link por WhatsApp todavía no
 * tiene cuenta, y mandarlo a un login vacío es donde se cae. Acá ve la cara de su
 * médico primero y recién después crea la cuenta.
 */
export default function ReferralLanding({ profile }) {
  const { codigo } = useParams()
  const navigate = useNavigate()
  const [pro, setPro] = useState(null)
  const [estado, setEstado] = useState('cargando') // cargando | ok | invalido

  useEffect(() => {
    let cancelado = false

    // Un refresh no debería inflar el contador de visitas: la visita se registra
    // una vez por código y por pestaña.
    const yaContada = sessionStorage.getItem(`healthier_ref_visit_${codigo}`) === '1'

    referralService.resolve(codigo, { registrarVisita: !yaContada })
      .then(data => {
        if (cancelado) return
        if (!data) {
          setEstado('invalido')
          track('referral_link_invalid', { codigo })
          return
        }
        sessionStorage.setItem(`healthier_ref_visit_${codigo}`, '1')
        storeReferral({ codigo, professionalId: data.professionalId, professionalName: data.fullName })
        setPro(data)
        setEstado('ok')
        track('referral_link_open', { codigo, professional_id: data.professionalId })
      })
      .catch(() => { if (!cancelado) setEstado('invalido') })

    return () => { cancelado = true }
  }, [codigo])

  // Si ya es paciente y tiene sesión, el link no tiene nada que ofrecerle salvo
  // llevarlo directo a reservar con ese profesional.
  useEffect(() => {
    if (estado === 'ok' && profile?.role === 'patient' && pro?.professionalProfileId) {
      navigate(`/paciente/profesional/${pro.professionalProfileId}`, { replace: true })
    }
  }, [estado, profile, pro, navigate])

  if (estado === 'cargando') {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (estado === 'invalido') {
    return (
      <div className="min-h-screen bg-bg-primary flex flex-col items-center justify-center px-6 text-center">
        <CompanyLogo size="sm" className="mb-8" />
        <h1 className="text-2xl font-light text-text-primary mb-2">Este link no es válido</h1>
        <p className="text-text-secondary text-sm max-w-sm mb-8">
          Puede que esté incompleto o que ya no esté en uso. Pedile a tu profesional que te lo mande de nuevo.
        </p>
        <Link to="/" className="btn-primary">Ir a Healthier</Link>
      </div>
    )
  }

  const especialidad = ESPECIALIDAD_LABEL[pro.specialty] ?? pro.specialty
  const nombre = pro.fullName

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      <header className="px-6 py-5">
        <CompanyLogo size="sm" />
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-16">
        <div className="w-full max-w-md">
          <div className="card text-center">
            {pro.avatarUrl ? (
              <img
                src={pro.avatarUrl}
                alt={nombre}
                className="w-24 h-24 rounded-full object-cover mx-auto mb-5"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-brand-muted flex items-center justify-center mx-auto mb-5">
                <HeartStraight className="h-9 w-9 text-brand" />
              </div>
            )}

            <p className="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-2">
              Te invitó a Healthier
            </p>
            <h1 className="text-3xl font-light tracking-tight text-text-primary">{nombre}</h1>

            <div className="flex items-center justify-center gap-2 mt-2 mb-6">
              {especialidad && <span className="text-text-secondary text-sm">{especialidad}</span>}
              {pro.isVerified && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand">
                  <SealCheck weight="fill" className="h-3.5 w-3.5" /> Verificado
                </span>
              )}
            </div>

            {pro.bio && (
              <p className="text-text-secondary text-sm leading-relaxed mb-6 text-left">{pro.bio}</p>
            )}

            <Link
              to="/registro"
              onClick={() => track('referral_link_cta', { codigo, professional_id: pro.professionalId })}
              className="btn-primary w-full inline-flex items-center justify-center gap-2"
            >
              Crear mi cuenta <ArrowRight className="h-4 w-4" />
            </Link>

            <p className="text-xs text-text-tertiary mt-4">
              ¿Ya tenés cuenta?{' '}
              <Link to="/login" className="text-brand hover:underline">Iniciá sesión</Link>
            </p>
          </div>

          <ul className="mt-6 space-y-2 text-sm text-text-secondary">
            <li className="flex items-start gap-2">
              <SealCheck weight="fill" className="h-4 w-4 text-brand mt-0.5 shrink-0" />
              Sacás turno con {nombre.split(' ')[0]} por videollamada o en consultorio.
            </li>
            <li className="flex items-start gap-2">
              <SealCheck weight="fill" className="h-4 w-4 text-brand mt-0.5 shrink-0" />
              Tus recetas y estudios te quedan guardados en la app.
            </li>
            <li className="flex items-start gap-2">
              <SealCheck weight="fill" className="h-4 w-4 text-brand mt-0.5 shrink-0" />
              Pagás la consulta desde el celular, sin efectivo ni transferencias.
            </li>
          </ul>
        </div>
      </main>
    </div>
  )
}
