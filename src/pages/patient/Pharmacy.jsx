import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MagnifyingGlass, Star, ShoppingBag, Pill, Plus, Minus } from '@phosphor-icons/react'
import { pharmacyService } from '../../services/pharmacyService'
import { medicationOrdersService } from '../../services/medicationOrdersService'
import { toast } from '../../components/Toast'

const CATEGORY_LABELS = {
  clinica:   'Clínica',
  pediatria: 'Pediatría',
  nutricion: 'Nutrición',
  bienestar: 'Bienestar',
}

function fmtPrice(price) {
  return `$${Number(price).toLocaleString('es-AR')}`
}

function ProductCard({ product, quantity, onAdd, onRemove }) {
  return (
    <div className="rounded-2xl border border-border-default bg-bg-secondary p-4 flex flex-col gap-2">
      <div className="w-full aspect-square rounded-xl bg-bg-primary flex items-center justify-center">
        <ShoppingBag className="w-7 h-7 text-text-tertiary" />
      </div>
      <div className="flex-1">
        <p className="font-semibold text-[14px] text-text-primary leading-tight">{product.name}</p>
        {product.description && (
          <p className="text-[11px] text-text-secondary mt-0.5 leading-snug">{product.description}</p>
        )}
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="font-semibold text-[15px] text-brand">{fmtPrice(product.price)}</span>
        {!product.inStock && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Sin stock</span>
        )}
      </div>
      {product.inStock && (
        quantity > 0 ? (
          <div className="flex items-center justify-between bg-brand/10 rounded-full px-2 py-1">
            <button onClick={() => onRemove(product)} className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-brand"><Minus className="w-3.5 h-3.5" /></button>
            <span className="font-semibold text-[13px] text-brand">{quantity}</span>
            <button onClick={() => onAdd(product)} className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-brand"><Plus className="w-3.5 h-3.5" /></button>
          </div>
        ) : (
          <button onClick={() => onAdd(product)} className="w-full py-2 rounded-full bg-brand text-white text-[13px] font-semibold flex items-center justify-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Agregar
          </button>
        )
      )}
    </div>
  )
}

export default function Pharmacy({ profile }) {
  const navigate = useNavigate()
  const [allProducts, setAllProducts] = useState([])
  const [featured, setFeatured] = useState([])
  const [suggested, setSuggested] = useState([])
  const [prescribed, setPrescribed] = useState([])
  const [pendingDraft, setPendingDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState({}) // productId -> { product, quantity }

  useEffect(() => {
    Promise.all([
      pharmacyService.getAll(),
      pharmacyService.getFeatured(),
      profile?.id ? pharmacyService.getSuggested(profile.id) : Promise.resolve([]),
      profile?.id ? pharmacyService.getPrescribedMatches(profile.id) : Promise.resolve([]),
      profile?.id ? medicationOrdersService.getPendingDraft(profile.id) : Promise.resolve(null),
    ])
      .then(([all, feat, sugg, presc, draft]) => {
        setAllProducts(all); setFeatured(feat); setSuggested(sugg); setPrescribed(presc); setPendingDraft(draft)
      })
      .catch(err => toast.error(err?.message || 'Error al cargar la farmacia'))
      .finally(() => setLoading(false))
  }, [profile?.id])

  const addToCart = (product) => {
    setCart(prev => ({ ...prev, [product.id]: { product, quantity: (prev[product.id]?.quantity ?? 0) + 1 } }))
  }
  const removeFromCart = (product) => {
    setCart(prev => {
      const current = prev[product.id]
      if (!current) return prev
      if (current.quantity <= 1) { const { [product.id]: _, ...rest } = prev; return rest }
      return { ...prev, [product.id]: { ...current, quantity: current.quantity - 1 } }
    })
  }
  const addPrescribedToCart = (match) => {
    addToCart(match.product)
  }

  const cartItems = Object.values(cart)
  const cartCount = cartItems.reduce((s, it) => s + it.quantity, 0)
  const cartTotal = cartItems.reduce((s, it) => s + Number(it.product.price) * it.quantity, 0)

  const goToCheckout = () => {
    if (!cartItems.length) return
    navigate('/paciente/farmacia/checkout', {
      state: {
        items: cartItems.map(it => ({
          pharmacyProductId: it.product.id,
          medicationName: it.product.name,
          presentation: it.product.description ?? null,
          quantity: it.quantity,
          unitPrice: it.product.price,
          requiresPrescription: it.product.requiresPrescription ?? false,
        })),
      },
    })
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return allProducts
    const q = query.trim().toLowerCase()
    return allProducts.filter(p => p.name.toLowerCase().includes(q))
  }, [allProducts, query])

  const byCategory = useMemo(() => {
    const groups = {}
    filtered.forEach(p => {
      if (!groups[p.category]) groups[p.category] = []
      groups[p.category].push(p)
    })
    return groups
  }, [filtered])

  return (
    <div className="absolute inset-0 flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 patient-column pt-6 pb-4 border-b border-border-default bg-bg-surface">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 rounded-lg hover:bg-bg-muted">
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <h1 className="font-bold text-text-primary">Farmacia</h1>
          <p className="text-xs text-text-secondary">Productos y medicamentos</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-40 patient-column">
        {/* Pedido sin terminar */}
        {pendingDraft && (
          <div className="mx-4 mt-4 rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-amber-800">Tenés un pedido sin completar</p>
              <p className="text-[11px] text-amber-700">Continuá para confirmar la dirección y pagar</p>
            </div>
            <button
              onClick={() => navigate('/paciente/farmacia/checkout', { state: { orderId: pendingDraft.id, items: pendingDraft.items, resumed: true } })}
              className="shrink-0 px-3 py-2 rounded-full bg-amber-600 text-white text-[12px] font-semibold"
            >
              Continuar
            </button>
          </div>
        )}

        {/* Search */}
        <div className="px-4 pt-4">
          <div className="relative">
            <MagnifyingGlass className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar productos..."
              className="form-input pl-10"
            />
          </div>
        </div>

        {loading ? (
          <div className="px-4 pt-6">
            <div className="h-32 rounded-2xl bg-bg-secondary animate-pulse" />
          </div>
        ) : (
          <>
            {!query && prescribed.length > 0 && (
              <div className="pt-6">
                <div className="flex items-center gap-1.5 px-4 mb-3">
                  <Pill className="w-3.5 h-3.5 text-brand-tertiary" />
                  <span className="text-[11px] font-semibold text-text-secondary tracking-wide uppercase">Recetados por tu médico</span>
                </div>
                <div className="px-4 flex flex-col gap-2">
                  {prescribed.map(({ medication, product }) => (
                    <div key={medication.id} className="rounded-2xl border border-brand-tertiary/30 bg-brand-tertiary/5 p-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-semibold text-text-primary">{medication.medicationName}</p>
                        <p className="text-[11px] text-text-secondary">{product.name} — {fmtPrice(product.price)}</p>
                      </div>
                      <button
                        onClick={() => addPrescribedToCart({ medication, product })}
                        className="shrink-0 px-3 py-2 rounded-full bg-brand-tertiary text-white text-[12px] font-semibold flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" /> Agregar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!query && featured.length > 0 && (
              <div className="pt-6">
                <div className="flex items-center gap-1.5 px-4 mb-3">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  <span className="text-[11px] font-semibold text-text-secondary tracking-wide uppercase">Destacados</span>
                </div>
                <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-1">
                  {featured.map(p => (
                    <div key={p.id} className="w-[160px] flex-shrink-0">
                      <ProductCard product={p} quantity={cart[p.id]?.quantity ?? 0} onAdd={addToCart} onRemove={removeFromCart} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!query && suggested.length > 0 && (
              <div className="pt-6">
                <span className="text-[11px] font-semibold text-text-secondary tracking-wide uppercase px-4 mb-3 block">
                  Sugeridos para vos
                </span>
                <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-1">
                  {suggested.map(p => (
                    <div key={p.id} className="w-[160px] flex-shrink-0">
                      <ProductCard product={p} quantity={cart[p.id]?.quantity ?? 0} onAdd={addToCart} onRemove={removeFromCart} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="px-4 pt-6 flex flex-col gap-6">
              {Object.keys(byCategory).length === 0 ? (
                <p className="text-text-tertiary text-[14px] text-center py-8">Sin resultados.</p>
              ) : (
                Object.entries(byCategory).map(([category, products]) => (
                  <div key={category}>
                    <span className="text-[11px] font-semibold text-text-secondary tracking-wide uppercase mb-3 block">
                      {CATEGORY_LABELS[category] || category}
                    </span>
                    <div className="grid grid-cols-2 gap-3">
                      {products.map(p => <ProductCard key={p.id} product={p} quantity={cart[p.id]?.quantity ?? 0} onAdd={addToCart} onRemove={removeFromCart} />)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Cart bar */}
      {cartCount > 0 && (
        <div className="absolute bottom-0 left-0 right-0 p-4 patient-column">
          <button
            onClick={goToCheckout}
            className="w-full py-4 rounded-full bg-brand text-white font-bold text-[15px] flex items-center justify-between px-6 shadow-lg"
          >
            <span>{cartCount} producto{cartCount !== 1 ? 's' : ''}</span>
            <span>Continuar — {fmtPrice(cartTotal)}</span>
          </button>
        </div>
      )}
    </div>
  )
}
