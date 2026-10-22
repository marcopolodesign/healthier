import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, MagnifyingGlass, Star, ShoppingBag, Plus, Minus, FunnelSimple, Stethoscope, Package,
  CheckCircle, LockSimple, ArrowsClockwise, Info, Prescription, VideoCamera, ArrowDown,
} from '@phosphor-icons/react'
import { pharmacyService } from '../../services/pharmacyService'
import { toast } from '../../components/Toast'
import { formatARS as fmtPrice } from '../../lib/format'
import { PRESCRIPTION_TYPES, PRESCRIPTION_TYPE_PATIENT_LABELS, necesitaReceta } from '../../lib/pharmacyProducts'
import { usePharmacyCart } from '../../context/PharmacyCartContext'

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

const ddmm = (fecha) => {
  if (!fecha) return null
  const d = new Date(fecha)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Chapita de estado. `tono`: vigente (verde) · receta (lavanda) · apagado (gris). */
function Chapa({ tono, icon: Icon, children }) {
  const clases = {
    vigente: 'bg-brand-muted text-brand-hover',
    receta: 'bg-brand-tertiary-muted text-brand-tertiary-hover',
    apagado: 'bg-bg-surface-hover text-text-secondary',
  }[tono]
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-0.5 rounded-full ${clases}`}>
      {Icon && <Icon className="w-3.5 h-3.5" />}{children}
    </span>
  )
}

/** "Pedir receta": relleno y con texto para que no se lea como deshabilitado (Felipe, 2026-10-22). */
function BotonPedirReceta({ onClick, className = '' }) {
  return (
    <button
      onClick={onClick}
      className={`py-2 rounded-full bg-brand-tertiary-hover hover:bg-brand-tertiary-hover/90 text-white text-[14px] font-semibold flex items-center justify-center gap-1.5 ${className}`}
    >
      <Stethoscope className="w-4 h-4" /> Pedir receta
    </button>
  )
}

function Stepper({ quantity, onAdd, onRemove }) {
  return (
    <div className="flex items-center justify-between bg-brand/10 rounded-full px-2 py-1 min-w-[96px]">
      <button onClick={onRemove} aria-label="Quitar uno" className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-brand"><Minus className="w-3.5 h-3.5" /></button>
      <span className="font-semibold text-[14px] text-brand px-2">{quantity}</span>
      <button onClick={onAdd} aria-label="Agregar uno" className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-brand"><Plus className="w-3.5 h-3.5" /></button>
    </div>
  )
}

/**
 * Tarjeta del catálogo.
 *
 * Un producto con receta que el paciente no tiene cubierto no se agrega: en
 * lugar del "+" muestra "Pedir receta", que abre la hoja de la videoconsulta.
 * Si igual llegara a agregarse (otra pestaña, receta que venció en el medio),
 * el servidor lo rechaza y se abre la misma hoja.
 */
function ProductCard({ product, quantity, cubierto, enNivelReceta, onAdd, onRemove, onPedirReceta }) {
  // Que haya URL no quiere decir que la foto cargue. El catálogo sembrado
  // apuntaba a un banco de imágenes de internet que dejó de servirlas, y las 20
  // fotos se veían como el ícono de imagen rota del navegador (2026-09-17).
  // Con el fallo tomado se cae al ícono, que es el mismo que ya se usa cuando
  // el producto no tiene foto.
  const [fotoFallo, setFotoFallo] = useState(false)
  const hasImage = product.imageUrl && !fotoFallo
  const conReceta = necesitaReceta(product)
  // En el nivel "Con receta" la chapa "Con receta" sobra: ahí sólo se marca el
  // controlado. En la grilla mezclada (búsqueda, filtros) van las dos.
  const chapa = conReceta && (!enNivelReceta || product.prescriptionType === 'receta_archivada')
    ? PRESCRIPTION_TYPE_PATIENT_LABELS[product.prescriptionType]
    : null
  return (
    <div className="rounded-2xl border border-border-default bg-bg-secondary p-3 flex flex-col gap-2 h-full">
      <div className="w-full aspect-square rounded-xl bg-bg-primary flex items-center justify-center overflow-hidden relative">
        {hasImage ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setFotoFallo(true)}
          />
        ) : (
          <ShoppingBag className="w-8 h-8 text-text-tertiary" />
        )}
        {chapa && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 bg-white/95 text-brand-tertiary-hover text-[12px] font-semibold px-2 py-0.5 rounded-full">
            {product.prescriptionType === 'receta_archivada' && <LockSimple className="w-3 h-3" />}{chapa}
          </span>
        )}
        {product.featured && product.inStock && !conReceta && (
          <div className="absolute top-2 right-2 bg-brand text-white text-xs font-semibold px-2 py-1 rounded-full">Destacado</div>
        )}
        {!product.inStock && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="text-white text-sm font-semibold">Agotado</span>
          </div>
        )}
      </div>
      <div className="flex-1 flex flex-col">
        <p className="text-xs font-medium text-brand uppercase tracking-wide">{CATEGORY_LABELS[product.category] || product.category}</p>
        <p className="font-semibold text-[14px] text-text-primary leading-tight mt-1">{product.name}</p>
        {product.description && (
          <p className="text-[13px] text-text-secondary mt-0.5 leading-snug line-clamp-2">{product.description}</p>
        )}
        <p className="font-bold text-[15px] text-text-primary mt-auto pt-2">{fmtPrice(product.price)}</p>
      </div>
      {/* Si ya está en el carrito se muestra el stepper aunque el producto se
          haya quedado sin stock — si no, queda adentro del pedido sin ninguna
          forma de sacarlo desde el catálogo. */}
      {quantity > 0 ? (
        <Stepper quantity={quantity} onAdd={() => onAdd(product)} onRemove={() => onRemove(product)} />
      ) : product.inStock && (
        conReceta && !cubierto ? (
          <BotonPedirReceta onClick={() => onPedirReceta(product)} className="w-full" />
        ) : (
          <button onClick={() => onAdd(product)} className="w-full py-2 rounded-full bg-brand text-white text-[14px] font-semibold flex items-center justify-center gap-1">
            <Plus className="w-4 h-4" /> Agregar
          </button>
        )
      )}
    </div>
  )
}

function PharmacyHeader({ onBack, subtitle, onVerPedidos }) {
  return (
    <div className="flex items-center gap-3 px-4 patient-column pt-6 pb-4 border-b border-border-default bg-bg-surface sticky top-0 z-30">
      <button onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-bg-muted">
        <ArrowLeft size={20} className="text-text-secondary" />
      </button>
      <div className="flex-1">
        <h1 className="font-bold text-text-primary">Farmacia</h1>
        {subtitle && <p className="text-xs text-text-secondary">{subtitle}</p>}
      </div>
      {onVerPedidos && (
        <button onClick={onVerPedidos} className="shrink-0 flex items-center gap-1 text-[12px] font-semibold text-brand px-2 py-1.5 rounded-lg hover:bg-brand/10">
          <Package className="w-4 h-4" /> Mis pedidos
        </button>
      )}
    </div>
  )
}

/** Título de nivel: Everett Light 40/44 y el subtítulo a 560 px (Felipe). */
function TituloNivel({ titulo, subtitulo }) {
  return (
    <div className="px-4">
      <h2 className="font-serif font-light text-[40px] leading-[44px] text-text-primary">{titulo}</h2>
      <p className="text-[16px] leading-[24px] text-text-secondary mt-2 max-w-[560px]">{subtitulo}</p>
    </div>
  )
}

function TituloSeccion({ icon: Icon, children, id }) {
  return (
    <div id={id} className="flex items-center gap-1.5 px-4 mb-3 scroll-mt-24">
      {Icon}
      <h3 className="text-[20px] font-medium text-text-primary">{children}</h3>
    </div>
  )
}

/**
 * Una receta vigente: lo recetado tal cual, y debajo el producto exacto que la
 * cubre. Se muestran las dos cosas porque los nombres del catálogo no son los
 * de la receta — y nunca se presenta el producto como si fuera la receta.
 */
function RecetaVigente({ receta, productos, cart }) {
  return (
    <div className="rounded-[24px] bg-bg-surface p-5 flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        <Chapa tono="vigente" icon={CheckCircle}>Vigente</Chapa>
        {receta.controlada && <Chapa tono="receta" icon={LockSimple}>Controlado</Chapa>}
        {receta.isChronic && <Chapa tono="vigente" icon={ArrowsClockwise}>Tratamiento prolongado</Chapa>}
      </div>
      <div>
        <p className="text-[18px] font-medium text-text-primary leading-snug">{receta.medicationName}</p>
        <p className="text-[14px] text-text-secondary">
          {[receta.profesional, receta.venceAt && `hasta el ${ddmm(receta.venceAt)}`].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="border-t border-border-default pt-3 flex flex-col gap-3">
        {productos.length === 0 ? (
          <p className="text-[14px] text-text-secondary">La farmacia no lo tiene disponible por ahora.</p>
        ) : productos.map(p => {
          const q = cart.quantityOf(p.id)
          return (
            <div key={p.id} className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-bg-primary flex items-center justify-center overflow-hidden shrink-0">
                {p.imageUrl ? <img src={p.imageUrl} alt="" className="w-full h-full object-cover" /> : <ShoppingBag className="w-5 h-5 text-text-tertiary" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold tracking-wide uppercase text-text-tertiary">En la farmacia</p>
                <p className="text-[14px] text-text-primary leading-snug">{p.name}</p>
                <p className="text-[14px] font-semibold text-text-primary">{fmtPrice(p.price)}</p>
              </div>
              {q > 0 ? (
                <Stepper quantity={q} onAdd={() => cart.add(p)} onRemove={() => cart.subtract(p)} />
              ) : (
                <button onClick={() => cart.add(p)} className="shrink-0 px-4 py-2 rounded-full bg-brand text-white text-[14px] font-semibold flex items-center gap-1">
                  <Plus className="w-4 h-4" /> Agregar
                </button>
              )}
            </div>
          )
        })}
      </div>
      <p className="flex items-center gap-1.5 text-[13px] text-text-secondary">
        <Info className="w-4 h-4 shrink-0" />
        {receta.maxEnvases > 1
          ? `Esta receta vale para una sola compra, de hasta ${receta.maxEnvases} envases.`
          : 'Esta receta vale para una sola compra.'}
      </p>
    </div>
  )
}

export default function Pharmacy({ profile }) {
  const navigate = useNavigate()
  const [allProducts, setAllProducts] = useState([])
  const [featured, setFeatured] = useState([])
  const [suggested, setSuggested] = useState([])
  const [recetas, setRecetas] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const cart = usePharmacyCart()
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [showStockOnly, setShowStockOnly] = useState(true)
  // 🔴 Arrancaba en `true`: el catálogo escondía todo producto sin foto.
  // Mientras las fotos existían —aunque estuvieran rotas— no se notaba; al
  // sacar las URLs muertas el catálogo quedó en CERO productos (2026-09-17).
  // Una farmacia no puede esconderle un medicamento a un paciente porque le
  // falta la foto: el filtro queda, pero hay que prenderlo a propósito.
  const [showWithPhotoOnly, setShowWithPhotoOnly] = useState(false)
  const [prescriptionType, setPrescriptionType] = useState(null) // null = todas
  const [showFilters, setShowFilters] = useState(false)
  const [canBuy, setCanBuy] = useState(null) // null = todavía no se sabe
  const misRecetasRef = useRef(null)

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
      pharmacyService.getMisRecetas(),
    ])
      .then(([all, feat, sugg, rec]) => {
        setAllProducts(all)
        setFeatured(feat)
        setSuggested(sugg)
        setRecetas(rec)
      })
      .catch(err => toast.error(err?.message || 'Error al cargar la farmacia'))
      .finally(() => setLoading(false))
  }, [profile?.id])

  // Al volver a la pantalla después de comprar, una receta vigente puede
  // haber pasado a "usada": se recarga cuando cambia el carrito (pagarlo lo
  // vacía), no en cada "+".
  const carritoPrevio = useRef(cart.orderId)
  useEffect(() => {
    const antes = carritoPrevio.current
    carritoPrevio.current = cart.orderId
    // Sólo cuando un carrito que existía desaparece (se pagó): la carga
    // inicial ya trae las recetas.
    if (!profile?.id || !antes || cart.orderId) return
    pharmacyService.getMisRecetas().then(setRecetas).catch(() => {})
  }, [profile?.id, cart.orderId])

  const productById = useMemo(() => new Map(allProducts.map(p => [p.id, p])), [allProducts])
  const vigentes = useMemo(() => recetas.filter(r => r.estado === 'vigente'), [recetas])
  const anteriores = useMemo(() => recetas.filter(r => r.estado !== 'vigente'), [recetas])
  // Lo que una receta vigente cubre. Sólo para decidir qué botón mostrar: la
  // regla de verdad la aplica la base al agregar.
  const cubiertos = useMemo(() => new Set(vigentes.flatMap(r => r.productoIds ?? [])), [vigentes])

  const addToCart = (product) => cart.add(product)
  const removeFromCart = (product) => cart.subtract(product)

  const tarjeta = (p, enNivelReceta = false) => (
    <ProductCard
      key={p.id}
      product={p}
      quantity={cart.quantityOf(p.id)}
      cubierto={cubiertos.has(p.id)}
      enNivelReceta={enNivelReceta}
      onAdd={addToCart}
      onRemove={removeFromCart}
      onPedirReceta={cart.pedirReceta}
    />
  )

  const hayFiltros = !!query || !!selectedCategory || !!prescriptionType || showWithPhotoOnly || !showStockOnly

  // Filter products
  const filteredProducts = useMemo(() => {
    let result = allProducts

    if (query) {
      const searchLower = query.toLowerCase()
      result = result.filter(p =>
        p.name.toLowerCase().includes(searchLower) ||
        (p.description && p.description.toLowerCase().includes(searchLower))
      )
    }
    if (selectedCategory) result = result.filter(p => p.category === selectedCategory)
    if (showStockOnly) result = result.filter(p => p.inStock)
    // Categoría de venta (migración 129). Los productos viejos pueden no
    // tenerla cargada: cuentan como venta libre, que es el default de la
    // columna — si no, filtrar por "Sin receta" los escondería.
    if (prescriptionType) {
      result = result.filter(p => (p.prescriptionType ?? 'venta_libre') === prescriptionType)
    }
    // Con foto: no se aplica cuando el paciente está buscando algo puntual —
    // ahí quiere encontrarlo aunque no tenga imagen.
    if (showWithPhotoOnly && !query) result = result.filter(p => p.imageUrl)
    return result
  }, [allProducts, query, selectedCategory, showStockOnly, showWithPhotoOnly, prescriptionType])

  const ventaLibre = useMemo(() => filteredProducts.filter(p => !necesitaReceta(p)), [filteredProducts])
  const conReceta = useMemo(() => filteredProducts.filter(necesitaReceta), [filteredProducts])

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

  const nivelReceta = vigentes.length > 0 || conReceta.length > 0 || anteriores.length > 0

  return (
    <div className="absolute inset-0 flex flex-col bg-bg-primary">
      <PharmacyHeader
        onBack={() => navigate(-1)}
        subtitle={`${filteredProducts.length} producto${filteredProducts.length !== 1 ? 's' : ''}`}
        onVerPedidos={() => navigate('/paciente/farmacia/pedidos')}
      />

      <div className={`flex-1 overflow-y-auto ${cart.count > 0 ? 'pb-32 sm:pb-8' : 'pb-8'}`}>
        <div className="patient-column">
          {/* Search & Filters */}
          <div className="px-4 pt-4 space-y-3">
            <div className="relative">
              <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Buscar productos…"
                className="form-input pl-9 text-sm"
              />
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-text-primary"
              >
                <FunnelSimple className="h-4 w-4" />
                Filtros
              </button>
              {/* Salto a las recetas: el nivel 2 queda abajo de todo el catálogo. */}
              {!hayFiltros && vigentes.length > 0 && (
                <button
                  onClick={() => misRecetasRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="flex items-center gap-1.5 text-[14px] font-semibold text-brand-tertiary-hover px-3 py-1.5 rounded-full bg-brand-tertiary-muted"
                >
                  <Prescription className="w-4 h-4" />
                  {vigentes.length === 1 ? 'Tenés 1 receta lista para usar' : `Tenés ${vigentes.length} recetas listas para usar`}
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

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
                  <p className="text-sm font-semibold text-text-primary mb-2">Receta</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setPrescriptionType(null)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        prescriptionType === null ? 'bg-brand text-white' : 'bg-bg-primary border border-border-default text-text-secondary'
                      }`}
                    >
                      Todas
                    </button>
                    {PRESCRIPTION_TYPES.map(type => (
                      <button
                        key={type}
                        onClick={() => setPrescriptionType(prescriptionType === type ? null : type)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          prescriptionType === type ? 'bg-brand text-white' : 'bg-bg-primary border border-border-default text-text-secondary'
                        }`}
                      >
                        {PRESCRIPTION_TYPE_PATIENT_LABELS[type]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showStockOnly}
                      onChange={(e) => setShowStockOnly(e.target.checked)}
                      className="w-4 h-4 rounded border-border-default"
                    />
                    Solo en stock
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showWithPhotoOnly}
                      onChange={(e) => setShowWithPhotoOnly(e.target.checked)}
                      className="w-4 h-4 rounded border-border-default"
                    />
                    Solo con foto
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="patient-column px-4 pt-6">
            <div className="h-32 rounded-2xl bg-bg-secondary animate-pulse" />
          </div>
        ) : hayFiltros ? (
          // Buscando o filtrando: una sola grilla, mezclada. Lo que necesita
          // receta y no está cubierto igual muestra "Pedir receta".
          <div className="patient-column px-4 pt-6">
            {filteredProducts.length === 0 ? (
              <div className="text-center py-12">
                <ShoppingBag className="h-10 w-10 text-text-muted mx-auto mb-3" />
                <p className="text-text-secondary">{query ? 'No encontramos productos' : 'Sin productos disponibles'}</p>
                {!query && showWithPhotoOnly && <p className="text-xs text-text-tertiary mt-1">Probá desactivar "Solo con foto" en Filtros</p>}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredProducts.map(p => tarjeta(p))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* ── NIVEL 1 · Sin receta ─────────────────────────────────── */}
            <section className="patient-column pt-8 pb-12">
              <TituloNivel titulo="Sin receta" subtitulo="Los comprás directo." />

              {featured.filter(p => !necesitaReceta(p)).length > 0 && (
                <div className="pt-8">
                  <TituloSeccion icon={<Star className="w-4 h-4 fill-amber-400 text-amber-400" weight="fill" />}>Destacados</TituloSeccion>
                  <div className="px-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {featured.filter(p => !necesitaReceta(p)).slice(0, 6).map(p => tarjeta(p))}
                  </div>
                </div>
              )}

              {suggested.filter(p => !necesitaReceta(p)).length > 0 && (
                <div className="pt-8">
                  <TituloSeccion>Sugeridos para vos</TituloSeccion>
                  <div className="px-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {suggested.filter(p => !necesitaReceta(p)).slice(0, 6).map(p => tarjeta(p))}
                  </div>
                </div>
              )}

              <div className="pt-8">
                <TituloSeccion>Todos los productos</TituloSeccion>
                {ventaLibre.length === 0 ? (
                  <p className="px-4 text-text-secondary">Sin productos disponibles.</p>
                ) : (
                  <div className="px-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {ventaLibre.map(p => tarjeta(p))}
                  </div>
                )}
              </div>
            </section>

            {/* ── NIVEL 2 · Con receta ─────────────────────────────────── */}
            {nivelReceta && (
              <section className="bg-receta-nivel rounded-t-[40px] pt-12 pb-16">
                <div className="patient-column">
                  <TituloNivel
                    titulo="Con receta"
                    subtitulo="Necesitan una receta vigente. Si no la tenés, la pedís en una videoconsulta con un clínico."
                  />

                  {vigentes.length > 0 && (
                    <div className="pt-8" ref={misRecetasRef}>
                      <TituloSeccion id="tus-recetas">Tus recetas vigentes</TituloSeccion>
                      <div className="px-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {vigentes.map(r => (
                          <RecetaVigente
                            key={r.clinicalMedicationId}
                            receta={r}
                            productos={(r.productoIds ?? []).map(id => productById.get(id)).filter(p => p?.inStock)}
                            cart={cart}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {conReceta.length > 0 && (
                    <div className="pt-8">
                      <TituloSeccion>Productos con receta</TituloSeccion>
                      <div className="px-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {conReceta.map(p => tarjeta(p, true))}
                      </div>
                    </div>
                  )}

                  {anteriores.length > 0 && (
                    <div className="pt-8">
                      <TituloSeccion>Recetas anteriores</TituloSeccion>
                      <div className="px-4">
                        <div className="rounded-[24px] bg-bg-surface divide-y divide-border-default max-w-[640px]">
                          {anteriores.map(r => (
                            <div key={r.clinicalMedicationId} className="flex items-center gap-3 p-4">
                              <button
                                onClick={() => r.rctaPrescriptionId && navigate(`/paciente/receta/${r.rctaPrescriptionId}`)}
                                className="flex items-center gap-3 flex-1 min-w-0 text-left"
                              >
                                <div className="w-11 h-11 rounded-xl bg-bg-primary flex items-center justify-center shrink-0">
                                  <Prescription className="w-5 h-5 text-text-secondary" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-[15px] font-medium text-text-primary truncate">{r.medicationName}</p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <Chapa tono="apagado">{r.estado === 'usada' ? 'Usada' : 'Vencida'}</Chapa>
                                    <span className="text-[13px] text-text-secondary">Emitida el {ddmm(r.emitidaAt)}</span>
                                  </div>
                                </div>
                              </button>
                              <button
                                onClick={() => navigate('/paciente/ondemand/clinica')}
                                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full bg-brand-tertiary-muted text-brand-tertiary-hover text-[14px] font-semibold"
                              >
                                <VideoCamera className="w-4 h-4" /> Renovar
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Barra del carrito — abre la hoja con los productos, no salta al
          checkout: el paciente quiere revisar qué lleva antes de pagar. */}
      {cart.count > 0 && (
        <div className="fixed bottom-24 left-0 right-0 p-4 bg-bg-primary border-t border-border-default z-40 sm:static sm:border-t-0 sm:bg-transparent sm:p-0">
          <div className="patient-column">
            <button
              onClick={cart.openSheet}
              className="w-full py-4 rounded-full bg-brand text-white font-bold text-[15px] flex items-center justify-between px-6 shadow-lg"
            >
              <span className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4" weight="fill" />
                {cart.count} producto{cart.count !== 1 ? 's' : ''}
              </span>
              <span>Ver carrito — {fmtPrice(cart.total)}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
