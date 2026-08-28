import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MagnifyingGlass, Star, ShoppingBag, Pill, Plus, Minus, FunnelSimple, Stethoscope } from '@phosphor-icons/react'
import { pharmacyService } from '../../services/pharmacyService'
import { medicationOrdersService } from '../../services/medicationOrdersService'
import { toast } from '../../components/Toast'
import { formatARS as fmtPrice } from '../../lib/format'

const CATEGORY_LABELS = {
  clinica:   'Clínica',
  pediatria: 'Pediatría',
  nutricion: 'Nutrición',
  bienestar: 'Bienestar',
}

const CATEGORIES = [
  { id: 'clinica', label: 'Clínica' },
  { id: 'pediatria', label: 'Pediatría' },
  { id: 'nutricion', label: 'Nutrición' },
  { id: 'bienestar', label: 'Bienestar' },
]

function ProductCard({ product, quantity, onAdd, onRemove }) {
  const hasImage = product.image_url || product.imageUrl
  return (
    <div className="rounded-2xl border border-border-default bg-bg-secondary p-3 flex flex-col gap-2 h-full">
      <div className="w-full aspect-square rounded-xl bg-bg-primary flex items-center justify-center overflow-hidden relative">
        {hasImage ? (
          <img src={product.image_url || product.imageUrl} alt={product.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <ShoppingBag className="w-8 h-8 text-text-tertiary" />
        )}
        {product.featured && !product.in_stock === false && (
          <div className="absolute top-2 right-2 bg-brand text-white text-xs font-semibold px-2 py-1 rounded-full">Destacado</div>
        )}
        {!product.in_stock && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="text-white text-sm font-semibold">Agotado</span>
          </div>
        )}
      </div>
      <div className="flex-1 flex flex-col">
        <p className="text-xs font-medium text-brand uppercase tracking-wide">{CATEGORY_LABELS[product.category] || product.category}</p>
        <p className="font-semibold text-[14px] text-text-primary leading-tight mt-1">{product.name}</p>
        {(product.description) && (
          <p className="text-[11px] text-text-secondary mt-0.5 leading-snug line-clamp-2">{product.description}</p>
        )}
        <p className="font-bold text-[15px] text-brand mt-auto pt-2">{fmtPrice(product.price)}</p>
      </div>
      {product.in_stock && (
        quantity > 0 ? (
          <div className="flex items-center justify-between bg-brand/10 rounded-full px-2 py-1">
            <button onClick={() => onRemove(product)} className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-brand"><Minus className="w-3 h-3" /></button>
            <span className="font-semibold text-[12px] text-brand">{quantity}</span>
            <button onClick={() => onAdd(product)} className="w-6 h-6 rounded-full bg-white flex items-center justify-center text-brand"><Plus className="w-3 h-3" /></button>
          </div>
        ) : (
          <button onClick={() => onAdd(product)} className="w-full py-2 rounded-full bg-brand text-white text-[12px] font-semibold flex items-center justify-center gap-1">
            <Plus className="w-3 h-3" /> Agregar
          </button>
        )
      )}
    </div>
  )
}

function PharmacyHeader({ onBack, subtitle }) {
  return (
    <div className="flex items-center gap-3 px-4 patient-column pt-6 pb-4 border-b border-border-default bg-bg-surface sticky top-0 z-30">
      <button onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-bg-muted">
        <ArrowLeft size={20} className="text-text-secondary" />
      </button>
      <div>
        <h1 className="font-bold text-text-primary">Farmacia</h1>
        {subtitle && <p className="text-xs text-text-secondary">{subtitle}</p>}
      </div>
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
  const [cart, setCart] = useState({})
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [showStockOnly, setShowStockOnly] = useState(true)
  const [showFilters, setShowFilters] = useState(false)
  const [canBuy, setCanBuy] = useState(null) // null = todavía no se sabe

  useEffect(() => {
    setCanBuy(null) // vuelve a "no se sabe" hasta que resuelva para este perfil
    if (!profile?.id) return

    pharmacyService.hasBeenAttended()
      .then(setCanBuy)
      .catch(() => setCanBuy(true)) // no bloquear por un error de red, sólo por la regla

    // Se pide en paralelo al chequeo de arriba, no en cadena — si el paciente
    // no puede comprar, la pantalla de bloqueo reemplaza todo esto igual.
    Promise.all([
      pharmacyService.getAll(),
      pharmacyService.getFeatured(),
      pharmacyService.getSuggested(profile.id),
      pharmacyService.getPrescribedMatches(profile.id),
      medicationOrdersService.getPendingDraft(profile.id),
    ])
      .then(([all, feat, sugg, presc, draft]) => {
        setAllProducts(all)
        setFeatured(feat)
        setSuggested(sugg)
        setPrescribed(presc)
        setPendingDraft(draft)
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
          requiresPrescription: it.product.prescriptionType !== 'venta_libre',
        })),
      },
    })
  }

  // Filter products
  const filteredProducts = useMemo(() => {
    let result = allProducts

    // Text search
    if (query) {
      const searchLower = query.toLowerCase()
      result = result.filter(p =>
        p.name.toLowerCase().includes(searchLower) ||
        (p.description && p.description.toLowerCase().includes(searchLower))
      )
    }

    // Category filter
    if (selectedCategory) {
      result = result.filter(p => p.category === selectedCategory)
    }

    // Stock filter
    if (showStockOnly) {
      result = result.filter(p => p.in_stock)
    }

    // Image visibility: only show if has image, or if searching
    if (!query) {
      result = result.filter(p => p.image_url)
    }

    return result
  }, [allProducts, query, selectedCategory, showStockOnly])

  if (canBuy === false) {
    return (
      <div className="absolute inset-0 flex flex-col bg-bg-primary">
        <PharmacyHeader onBack={() => navigate(-1)} />
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4 patient-column">
          <div className="w-16 h-16 rounded-full bg-brand/10 flex items-center justify-center">
            <Stethoscope className="w-7 h-7 text-brand" />
          </div>
          <div>
            <p className="font-semibold text-text-primary">Todavía no tenés una consulta realizada</p>
            <p className="text-sm text-text-secondary mt-1">Para comprar en la farmacia primero tenés que atenderte con un profesional de Healthier.</p>
          </div>
          <button
            onClick={() => navigate('/paciente/dashboard')}
            className="px-5 py-3 rounded-full bg-brand text-white text-sm font-semibold"
          >
            Reservar una consulta
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute inset-0 flex flex-col bg-bg-primary">
      <PharmacyHeader
        onBack={() => navigate(-1)}
        subtitle={`${filteredProducts.length} producto${filteredProducts.length !== 1 ? 's' : ''}`}
      />

      <div className={`flex-1 overflow-y-auto ${cartCount > 0 ? 'pb-32 sm:pb-8' : 'pb-8'} patient-column`}>
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

        {/* Search & Filters */}
        <div className="px-4 pt-4 space-y-3">
          <div className="relative">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar productos..."
              className="form-input pl-9 text-sm"
            />
          </div>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-text-primary"
          >
            <FunnelSimple className="h-4 w-4" />
            Filtros
          </button>

          {showFilters && (
            <div className="rounded-2xl border border-border-default bg-bg-surface p-4 space-y-4">
              <div>
                <p className="text-sm font-semibold text-text-primary mb-2">Categoría</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedCategory(null)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      selectedCategory === null ? 'bg-brand text-white' : 'bg-bg-primary border border-border-default text-text-secondary'
                    }`}
                  >
                    Todas
                  </button>
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        selectedCategory === cat.id ? 'bg-brand text-white' : 'bg-bg-primary border border-border-default text-text-secondary'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-text-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showStockOnly}
                    onChange={(e) => setShowStockOnly(e.target.checked)}
                    className="w-4 h-4 rounded border-border-default"
                  />
                  Solo en stock
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Content */}
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
                <div className="px-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {featured.slice(0, 6).map(p => (
                    <ProductCard key={p.id} product={p} quantity={cart[p.id]?.quantity ?? 0} onAdd={addToCart} onRemove={removeFromCart} />
                  ))}
                </div>
              </div>
            )}

            {!query && suggested.length > 0 && (
              <div className="pt-6">
                <span className="text-[11px] font-semibold text-text-secondary tracking-wide uppercase px-4 mb-3 block">
                  Sugeridos para vos
                </span>
                <div className="px-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {suggested.slice(0, 6).map(p => (
                    <ProductCard key={p.id} product={p} quantity={cart[p.id]?.quantity ?? 0} onAdd={addToCart} onRemove={removeFromCart} />
                  ))}
                </div>
              </div>
            )}

            {/* Grid view */}
            <div className="px-4 pt-6">
              {filteredProducts.length === 0 ? (
                <div className="text-center py-12">
                  <ShoppingBag className="h-10 w-10 text-text-muted mx-auto mb-3" />
                  <p className="text-text-secondary">{query ? 'No encontramos productos' : 'Sin productos disponibles'}</p>
                  {!query && <p className="text-xs text-text-tertiary mt-1">Los productos aparecen cuando tienen imágenes</p>}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {filteredProducts.map(p => (
                    <ProductCard key={p.id} product={p} quantity={cart[p.id]?.quantity ?? 0} onAdd={addToCart} onRemove={removeFromCart} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Checkout button — fixed above nav on mobile */}
      {cartCount > 0 && (
        <div className="fixed bottom-24 left-0 right-0 p-4 bg-bg-primary border-t border-border-default z-40 sm:static sm:border-t-0 sm:bg-transparent sm:p-0">
          <div className="patient-column">
            <button
              onClick={goToCheckout}
              className="w-full py-4 rounded-full bg-brand text-white font-bold text-[15px] flex items-center justify-between px-6 shadow-lg"
            >
              <span>{cartCount} producto{cartCount !== 1 ? 's' : ''}</span>
              <span>Continuar — {fmtPrice(cartTotal)}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
