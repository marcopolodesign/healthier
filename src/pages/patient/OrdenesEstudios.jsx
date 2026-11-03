import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { TestTube, CaretLeft, ShareNetwork } from '@phosphor-icons/react'
import { ordenesEstudiosService, resumenDeEstudios } from '../../services/ordenesEstudiosService'
import { toast } from '../../components/Toast'

/**
 * Mis órdenes de estudios — /paciente/ordenes-estudios (migración 227).
 *
 * Las órdenes que le emitieron sus profesionales por el servicio de recetas.
 * Se llega desde la carpeta "Órdenes de estudios" de la Bóveda (aparece sólo si
 * tiene alguna), desde el mail y desde el aviso. Mismo diseño que Certificados.
 */
export default function OrdenesEstudios({ profile }) {
  const navigate = useNavigate()
  const [lista, setLista] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.id) { setLoading(false); return }
    let cancelled = false
    ordenesEstudiosService.listarDelPaciente(profile.id)
      .then(r => { if (!cancelled) setLista(r) })
      .catch(err => { if (!cancelled) { setLista([]); toast.error(`No pudimos cargar tus órdenes: ${err.message}`) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [profile?.id])

  const compartir = async (c) => {
    const titulo = `Orden de estudios: ${resumenDeEstudios(c.estudios)}`
    if (navigator.share) {
      try { await navigator.share({ title: titulo, url: c.rctaPdfUrl }) } catch { /* canceló */ }
      return
    }
    window.open(c.rctaPdfUrl, '_blank', 'noopener')
  }

  return (
    <div className="absolute inset-0 bg-bg-primary overflow-y-auto scrollbar-hide">
      <div className="max-w-lg mx-auto px-6 pt-6 pb-32">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-[13px] font-medium text-text-tertiary hover:text-text-secondary transition-colors mb-4"
        >
          <CaretLeft className="w-4 h-4" /> Volver
        </button>

        <h1 className="font-serif text-3xl font-light text-text-primary mb-1">Órdenes de estudios</h1>
        <p className="text-[14px] text-text-secondary mb-6">Presentalas en el laboratorio o centro donde te hagas los estudios.</p>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          </div>
        ) : lista.length === 0 ? (
          <div className="bg-bg-secondary border border-border-default rounded-2xl p-6 text-center">
            <p className="text-[14px] text-text-secondary">Todavía no tenés órdenes de estudios.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {lista.map(c => (
              <div key={c.id} className="flex items-center gap-4 bg-bg-secondary border border-border-default rounded-2xl p-4">
                <div className="w-10 h-10 rounded-xl bg-brand-muted flex items-center justify-center shrink-0">
                  <TestTube className="w-5 h-5 text-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-text-primary truncate">{resumenDeEstudios(c.estudios)}</p>
                  <p className="text-[12px] text-text-tertiary mt-0.5 truncate">
                    {[
                      new Date(c.rctaIssuedAt ?? c.createdAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'America/Argentina/Buenos_Aires' }),
                      c.professional?.fullName,
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button type="button" onClick={() => compartir(c)} aria-label="Compartir"
                  className="w-9 h-9 rounded-full border border-border-default flex items-center justify-center text-text-secondary hover:text-brand shrink-0">
                  <ShareNetwork className="w-4 h-4" />
                </button>
                <a href={c.rctaPdfUrl} target="_blank" rel="noreferrer"
                  className="px-4 py-2 rounded-full bg-white border border-border-default text-[13px] font-semibold text-text-primary shrink-0">
                  Ver
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
