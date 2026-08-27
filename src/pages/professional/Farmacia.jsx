import { useState, useEffect } from 'react'
import { MagnifyingGlass, FunnelSimple, X } from '@phosphor-icons/react'
import { supabase } from '../../lib/supabase'
import { toast } from '../../components/Toast'
import { formatARS } from '../../lib/format'

const CATEGORIES = [
  { id: 'clinica', label: 'Clínica' },
  { id: 'pediatria', label: 'Pediatría' },
  { id: 'nutricion', label: 'Nutrición' },
  { id: 'bienestar', label: 'Bienestar' },
]

export default function Farmacia({ profile }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [showStockOnly, setShowStockOnly] = useState(true)
  const [showFilters, setShowFilters] = useState(false)

  // Load products from Supabase
  useEffect(() => {
    loadProducts()
  }, [])

  const loadProducts = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('pharmacy_products')
        .select('*')
        .order('featured', { ascending: false })
        .order('name', { ascending: true })

      if (error) throw error
      setProducts(data || [])
    } catch (err) {
      console.error('Error loading products:', err)
      toast.error('Error al cargar los productos')
    } finally {
      setLoading(false)
    }
  }

  // Filter products
  const filteredProducts = products.filter(product => {
    // Text search in name and description
    if (search) {
      const searchLower = search.toLowerCase()
      const matches = product.name.toLowerCase().includes(searchLower) ||
                     (product.description && product.description.toLowerCase().includes(searchLower))
      if (!matches) return false
    }

    // Category filter
    if (selectedCategory && product.category !== selectedCategory) return false

    // Stock filter
    if (showStockOnly && !product.in_stock) return false

    // Image visibility: only show if has image, or if searching
    if (!search && !product.image_url) return false

    return true
  })

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Farmacia</h1>
          <p className="text-text-secondary text-sm mt-1">
            {filteredProducts.length} producto{filteredProducts.length !== 1 ? 's' : ''} disponible{filteredProducts.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Search and Filter Bar */}
      <div className="space-y-3">
        {/* Search */}
        <div className="relative">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-border-default rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </div>

        {/* Filter Toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
        >
          <FunnelSimple className="h-4 w-4" />
          Filtros
        </button>

        {/* Filters Panel */}
        {showFilters && (
          <div className="card space-y-4 border border-border-default">
            {/* Categories */}
            <div>
              <p className="text-sm font-semibold text-text-primary mb-2">Categoría</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    selectedCategory === null
                      ? 'bg-brand text-white'
                      : 'bg-bg-surface border border-border-default text-text-secondary hover:bg-bg-secondary'
                  }`}
                >
                  Todas
                </button>
                {CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      selectedCategory === cat.id
                        ? 'bg-brand text-white'
                        : 'bg-bg-surface border border-border-default text-text-secondary hover:bg-bg-secondary'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Stock Filter */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={showStockOnly}
                  onChange={(e) => setShowStockOnly(e.target.checked)}
                  className="w-4 h-4 rounded border-border-default"
                />
                Solo productos en stock
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Products Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="card p-4 h-80 animate-pulse">
              <div className="w-full h-32 bg-bg-surface rounded-lg mb-3" />
              <div className="h-4 bg-bg-surface rounded mb-2" />
              <div className="h-3 bg-bg-surface rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="card text-center py-16">
          <MagnifyingGlass className="h-10 w-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-secondary">
            {search ? 'No encontramos productos que coincidan con tu búsqueda' : 'Sin productos disponibles'}
          </p>
          {!search && (
            <p className="text-xs text-text-tertiary mt-2">Los productos aparecen cuando tienen imágenes</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProducts.map(product => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProductCard({ product }) {
  const category = CATEGORIES.find(c => c.id === product.category)

  return (
    <div className="card h-full overflow-hidden hover:shadow-lg transition-shadow duration-200 flex flex-col">
      {/* Image */}
      <div className="relative bg-bg-surface aspect-square overflow-hidden flex items-center justify-center">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-text-tertiary text-sm">Sin imagen</div>
        )}

        {/* Stock badge */}
        {!product.in_stock && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="text-white text-sm font-semibold">Agotado</span>
          </div>
        )}

        {/* Featured badge */}
        {product.featured && product.in_stock && (
          <div className="absolute top-2 right-2 bg-brand text-white text-xs font-semibold px-2.5 py-1 rounded-full">
            Destacado
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3 flex-1 flex flex-col">
        <div className="mb-1">
          <p className="text-xs font-medium text-brand uppercase tracking-wide">{category?.label}</p>
        </div>
        <h3 className="font-semibold text-text-primary text-sm mb-1 line-clamp-2">
          {product.name}
        </h3>
        {product.description && (
          <p className="text-xs text-text-tertiary mb-3 line-clamp-2">
            {product.description}
          </p>
        )}

        {/* Price */}
        <div className="mt-auto">
          <p className="text-lg font-bold text-text-primary">
            {formatARS(product.price)}
          </p>
        </div>
      </div>
    </div>
  )
}
