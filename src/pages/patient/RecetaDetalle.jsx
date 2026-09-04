import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { FileText, CaretLeft, Pill, Warning, CheckCircle, Plus } from '@phosphor-icons/react'
import { pharmacyService } from '../../services/pharmacyService'
import { usePharmacyCart } from '../../context/PharmacyCartContext'
import { toast } from '../../components/Toast'

/**
 * Una receta — /paciente/receta/:prescriptionId
 *
 * Fecha, hora, profesional y los medicamentos recetados; y para cada uno, si la
 * farmacia lo tiene, la opción de agregarlo al carrito. "Comprar todos" agrega
 * los disponibles de una y abre la hoja del carrito, que continúa al checkout
 * de farmacia que ya existe — la hoja **no** cierra la compra (Mateo,
 * 2026-09-04).
 *
 * 🔴 **Se muestra siempre lo recetado Y el producto, por separado.** El match
 * es por palabra clave, así que puede traer otra presentación de la misma
 * droga: presentarlo como si fuera exactamente lo recetado sería mentirle al
 * paciente sobre su medicación. Cuando difieren, se marca.
 */
export default function RecetaDetalle({ profile }) {
  const { prescriptionId } = useParams()
  const navigate = useNavigate()
  const cart = usePharmacyCart()

  const [medicamentos, setMedicamentos] = useState([])
  const [pedido, setPedido] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.id || !prescriptionId) return
    let cancelled = false
    pharmacyService.getPrescriptionMatch(prescriptionId, profile.id)
      .then(({ medicamentos: m, pedido: p }) => {
        if (cancelled) return
        setMedicamentos(m)
        setPedido(p)
      })
      .catch(() => { if (!cancelled) setMedicamentos([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [profile?.id, prescriptionId])

  const cabecera = medicamentos[0]?.medication
  const emitidaEn = cabecera?.rctaIssuedAt ?? cabecera?.createdAt ?? null
  const disponibles = medicamentos.filter(m => m.product)
  const faltantes = medicamentos.filter(m => !m.product)

  const comprarTodos = () => {
    if (!disponibles.length) return
    disponibles.forEach(m => cart.add(m.product))
    toast.success(disponibles.length === 1
      ? 'Agregamos el medicamento a tu pedido'
      : `Agregamos ${disponibles.length} medicamentos a tu pedido`)
    cart.openSheet()
  }

  const agregarUno = (m) => {
    cart.add(m.product)
    cart.openSheet()
  }

  if (loading) {
    return (
      <div className="absolute inset-0 bg-bg-primary flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!medicamentos.length) {
    return (
      <div className="absolute inset-0 bg-bg-primary flex flex-col items-center justify-center px-6 text-center">
        <p className="text-[15px] text-text-secondary mb-6">No pudimos encontrar esta receta.</p>
        <button onClick={() => navigate('/paciente/recetas')} className="px-6 py-3 rounded-full bg-brand text-white font-bold text-[14px]">
          Ver mis recetas
        </button>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 bg-bg-primary overflow-y-auto scrollbar-hide">
      <div className="max-w-lg mx-auto px-6 pt-6 pb-40">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-[13px] font-medium text-text-tertiary hover:text-text-secondary transition-colors mb-4"
        >
          <CaretLeft className="w-4 h-4" /> Volver
        </button>

        <h1 className="font-serif text-3xl text-text-primary mb-1">Tu receta</h1>
        <p className="text-[13px] text-text-secondary mb-5">
          {[
            emitidaEn
              ? new Date(emitidaEn).toLocaleString('es-AR', {
                  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
                })
              : null,
            cabecera?.professional?.fullName,
          ].filter(Boolean).join(' · ')}
        </p>

        {cabecera?.rctaPdfUrl && (
          <a
            href={cabecera.rctaPdfUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 bg-bg-secondary border border-border-default rounded-2xl p-4 mb-6 hover:border-brand transition-colors"
          >
            <FileText className="w-5 h-5 text-brand shrink-0" />
            <span className="flex-1 text-[14px] font-semibold text-text-primary">Ver la receta en PDF</span>
            <span className="text-[13px] font-semibold text-brand">Abrir</span>
          </a>
        )}

        <div className="flex items-center gap-2 mb-3">
          <Pill className="w-4 h-4 text-brand" />
          <h2 className="text-[16px] font-semibold text-text-primary">Medicamentos recetados</h2>
        </div>

        <div className="space-y-3">
          {medicamentos.map(({ medication, product }) => {
            const enCarrito = product ? cart.quantityOf(product.id) : 0
            // Lo recetado y el producto se muestran por separado siempre que no
            // sean el mismo texto: el match es por palabra clave y puede
            // cambiar marca, dosis o presentación.
            const difiere = product && product.name.trim().toLowerCase() !== (medication.medicationName ?? '').trim().toLowerCase()
            return (
              <div key={medication.id} className="bg-bg-secondary border border-border-default rounded-2xl p-4">
                <p className="text-[14px] font-semibold text-text-primary">{medication.medicationName}</p>
                {(medication.dosageText || medication.frequency) && (
                  <p className="text-[13px] text-text-secondary mt-0.5">
                    {[medication.dosageText, medication.frequency].filter(Boolean).join(' · ')}
                  </p>
                )}

                {product ? (
                  <div className="mt-3 pt-3 border-t border-border-default">
                    {difiere && (
                      <p className="text-[11px] text-text-tertiary mb-1.5">
                        En la farmacia está como:
                      </p>
                    )}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-text-primary truncate">{product.name}</p>
                        <p className="text-[12px] text-text-tertiary">
                          {[product.presentation, product.price != null ? `$${Number(product.price).toLocaleString('es-AR')}` : null]
                            .filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {enCarrito > 0 ? (
                        <span className="flex items-center gap-1 text-[13px] font-semibold text-brand shrink-0">
                          <CheckCircle className="w-4 h-4" weight="fill" /> En tu pedido
                        </span>
                      ) : (
                        <button
                          onClick={() => agregarUno({ product })}
                          disabled={!!pedido}
                          className="flex items-center gap-1 px-3 py-2 rounded-full bg-brand text-white text-[13px] font-semibold disabled:bg-gray-200 disabled:text-gray-400 shrink-0"
                        >
                          <Plus className="w-4 h-4" /> Agregar
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 pt-3 border-t border-border-default flex items-center gap-2">
                    <Warning className="w-4 h-4 text-amber-600 shrink-0" />
                    <p className="text-[12px] text-amber-700">
                      La farmacia no lo tiene disponible por ahora.
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Receta ya pedida: no se vuelve a comprar desde acá, se muestra el pedido. */}
        {pedido ? (
          <button
            onClick={() => navigate(`/paciente/farmacia/pedido/${pedido.id}`)}
            className="w-full mt-6 py-4 rounded-full font-bold text-[15px] text-text-primary bg-bg-secondary border border-border-default hover:border-brand transition-colors"
          >
            Ya la pediste — ver el pedido
          </button>
        ) : disponibles.length > 0 ? (
          <>
            <button
              onClick={comprarTodos}
              className="w-full mt-6 py-4 rounded-full font-bold text-[15px] text-white bg-brand hover:bg-brand-hover transition-all shadow-md active:scale-95"
            >
              {disponibles.length === medicamentos.length
                ? 'Comprar todos'
                : `Comprar los ${disponibles.length} disponibles`}
            </button>
            {faltantes.length > 0 && (
              <p className="text-[12px] text-text-tertiary text-center mt-2">
                {faltantes.length === 1
                  ? '1 medicamento de la receta no está disponible en la farmacia.'
                  : `${faltantes.length} medicamentos de la receta no están disponibles en la farmacia.`}
              </p>
            )}
          </>
        ) : (
          <p className="text-[13px] text-text-tertiary text-center mt-6">
            Por ahora la farmacia no tiene ninguno de los medicamentos de esta receta.
          </p>
        )}
      </div>
    </div>
  )
}
