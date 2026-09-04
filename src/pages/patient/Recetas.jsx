import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, CaretLeft } from '@phosphor-icons/react'
import { historiaClinicaService } from '../../services/historiaClinicaService'

/**
 * Mis recetas — /paciente/recetas
 *
 * Todas las recetas electrónicas emitidas al paciente, en un solo lugar.
 *
 * Antes sólo se llegaba a una receta desde la consulta que la generó: había que
 * acordarse de cuál fue y entrar al Historial. La categoría "Recetas" de la
 * Bóveda **no** sirve para esto — es de documentos subidos a mano y hoy está
 * vacía (`comingSoon`), no lee nada de la receta electrónica.
 *
 * La entrada vive en el inicio y **sólo aparece si el paciente tiene alguna**
 * (Mateo, 2026-09-04): un acceso a una lista vacía es ruido.
 */
export default function Recetas({ profile }) {
  const navigate = useNavigate()
  const [recetas, setRecetas] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    historiaClinicaService.getIssuedPrescriptions(profile.id)
      .then(r => { if (!cancelled) setRecetas(r) })
      .catch(() => { if (!cancelled) setRecetas([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [profile?.id])

  return (
    <div className="absolute inset-0 bg-bg-primary overflow-y-auto scrollbar-hide">
      <div className="max-w-lg mx-auto px-6 pt-6 pb-32">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-[13px] font-medium text-text-tertiary hover:text-text-secondary transition-colors mb-4"
        >
          <CaretLeft className="w-4 h-4" /> Volver
        </button>

        <h1 className="font-serif text-3xl text-text-primary mb-1">Mis recetas</h1>
        <p className="text-[14px] text-text-secondary mb-6">
          Las recetas que te emitieron tus profesionales.
        </p>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          </div>
        ) : recetas.length === 0 ? (
          <div className="bg-bg-secondary border border-border-default rounded-2xl p-6 text-center">
            <p className="text-[14px] text-text-secondary">Todavía no tenés recetas emitidas.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recetas.map(r => (
              <button
                key={r.id}
                onClick={() => navigate(`/paciente/receta/${r.id}`)}
                className="w-full text-left flex items-center gap-4 bg-bg-secondary border border-border-default rounded-2xl p-4 hover:border-brand transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-brand-muted flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-text-primary truncate">
                    {r.medicamentos.filter(Boolean).join(' · ') || 'Receta'}
                  </p>
                  <p className="text-[12px] text-text-tertiary mt-0.5">
                    {[
                      r.emitidaEn
                        ? new Date(r.emitidaEn).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
                        : null,
                      r.profesional,
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span className="text-[13px] font-semibold text-brand shrink-0">Ver</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
