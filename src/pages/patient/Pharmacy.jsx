import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MagnifyingGlass, Star, ShoppingBag } from '@phosphor-icons/react'
import { pharmacyService } from '../../services/pharmacyService'

const CATEGORY_LABELS = {
  clinica:   'Clínica',
  pediatria: 'Pediatría',
  nutricion: 'Nutrición',
  bienestar: 'Bienestar',
}

function fmtPrice(price) {
  return `$${Number(price).toLocaleString('es-AR')}`
}

function ProductCard({ product }) {
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
    </div>
  )
}

export default function Pharmacy({ profile }) {
  const navigate = useNavigate()
  const [allProducts, setAllProducts] = useState([])
  const [featured, setFeatured] = useState([])
  const [suggested, setSuggested] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    Promise.all([
      pharmacyService.getAll(),
      pharmacyService.getFeatured(),
      profile?.id ? pharmacyService.getSuggested(profile.id) : Promise.resolve([]),
    ])
      .then(([all, feat, sugg]) => { setAllProducts(all); setFeatured(feat); setSuggested(sugg) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [profile?.id])

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

      <div className="flex-1 overflow-y-auto pb-32 patient-column">
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
            {!query && featured.length > 0 && (
              <div className="pt-6">
                <div className="flex items-center gap-1.5 px-4 mb-3">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  <span className="text-[11px] font-semibold text-text-secondary tracking-wide uppercase">Destacados</span>
                </div>
                <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-1">
                  {featured.map(p => (
                    <div key={p.id} className="w-[160px] flex-shrink-0">
                      <ProductCard product={p} />
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
                      <ProductCard product={p} />
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
                      {products.map(p => <ProductCard key={p.id} product={p} />)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
