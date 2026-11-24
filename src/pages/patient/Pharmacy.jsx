import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, MagnifyingGlass, ShoppingBag, Pill, Plus, Minus, FunnelSimple, Stethoscope, Package,
  Check, LockSimple, ArrowsClockwise, Info, Prescription, VideoCamera,
} from '@phosphor-icons/react'
import { pharmacyService } from '../../services/pharmacyService'
import { toast } from '../../components/Toast'
import { formatARS as fmtPrice } from '../../lib/format'
import {
  PRESCRIPTION_TYPES, PRESCRIPTION_TYPE_PATIENT_LABELS, necesitaReceta, CATEGORIAS, gruposDelMosaico, nombreLegible,
} from '../../lib/pharmacyProducts'
import { usePharmacyCart } from '../../context/PharmacyCartContext'

// Farmacia del paciente — rediseño 2026-11-22 (propuesta de Felipe, versión
// "A + C con la tipografía de hoy" que eligió Mateo):
//   · arriba, lo recetado por el médico en una tarjeta grande con su botón;
//   · abajo, un mosaico de fotos (carrusel horizontal en el teléfono): las necesidades (Dolor y fiebre…) y las
//     cuatro categorías de siempre. Tocar una abre su página (`?grupo=<id>`):
//     la foto arriba y los productos abajo, sobre relleno, con el + adentro.
// Buscar o filtrar sigue dando una sola grilla mezclada.

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

/** Cantidad dentro de la foto del producto: verde lleno, como el +. */
function Stepper({ quantity, onAdd, onRemove }) {
  return (
    <div className="flex items-center gap-1 bg-brand rounded-full p-1 text-white">
      <button onClick={onRemove} aria-label="Quitar uno" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/15"><Minus className="w-4 h-4" /></button>
      <span className="font-semibold text-[15px] min-w-[1.25rem] text-center">{quantity}</span>
      <button onClick={onAdd} aria-label="Agregar uno" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/15"><Plus className="w-4 h-4" /></button>
    </div>
  )
}

/**
 * Producto: la foto sobre relleno con la acción adentro, y el nombre y el
 * precio debajo.
 *
 * Un producto con receta que el paciente no tiene cubierto no se agrega: en
 * lugar del + muestra "Pedir receta", que abre la hoja de la videoconsulta.
 * Si igual llegara a agregarse (otra pestaña, receta que venció en el medio),
 * el servidor lo rechaza y se abre la misma hoja.
 */
function ProductTile({ product, quantity, cubierto, onAdd, onRemove, onPedirReceta }) {
  // Que haya URL no quiere decir que la foto cargue (2026-09-17): con el fallo
  // tomado se cae al ícono, el mismo que cuando el producto no tiene foto.
  const [fotoFallo, setFotoFallo] = useState(false)
  const hasImage = product.imageUrl && !fotoFallo
  const conReceta = necesitaReceta(product)
  return (
    <div className="flex flex-col">
      <div className="relative aspect-square rounded-[20px] bg-bg-surface-hover overflow-hidden flex items-center justify-center">
        {hasImage ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full object-contain p-4 mix-blend-multiply"
            loading="lazy"
            onError={() => setFotoFallo(true)}
          />
        ) : (
          <Pill className="w-10 h-10 text-text-primary opacity-30" />
        )}
        {conReceta && (
          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 bg-bg-surface text-brand-tertiary-hover text-[12px] font-semibold px-2 py-0.5 rounded-full">
            {product.prescriptionType === 'receta_archivada' && <LockSimple className="w-3 h-3" />}
            {PRESCRIPTION_TYPE_PATIENT_LABELS[product.prescriptionType]}
          </span>
        )}
        {!product.inStock && quantity === 0 && (
          <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
            <span className="text-white text-sm font-semibold">Agotado</span>
          </div>
        )}
        {/* Si ya está en el carrito se muestra la cantidad aunque se haya
            quedado sin stock — si no, no habría cómo sacarlo desde acá. */}
        <div className="absolute bottom-2.5 right-2.5">
          {quantity > 0 ? (
            <Stepper quantity={quantity} onAdd={() => onAdd(product)} onRemove={() => onRemove(product)} />
          ) : product.inStock && (
            conReceta && !cubierto ? (
              <button
                onClick={() => onPedirReceta(product)}
                className="h-10 px-3.5 rounded-full bg-brand-tertiary-hover hover:bg-brand-tertiary-hover/90 text-white text-[14px] font-semibold flex items-center gap-1.5"
              >
                <Stethoscope className="w-4 h-4" /> Pedir receta
              </button>
            ) : (
              <button
                onClick={() => onAdd(product)}
                aria-label={`Agregar ${product.name}`}
                className="w-10 h-10 rounded-full bg-brand hover:bg-brand-hover text-white flex items-center justify-center"
              >
                <Plus className="w-5 h-5" />
              </button>
            )
          )}
        </div>
      </div>
      <p className="text-[15px] leading-snug text-text-primary mt-2.5 line-clamp-2" title={product.name}>{nombreLegible(product.name)}</p>
      <p className="text-[15px] text-text-secondary mt-0.5">{fmtPrice(product.price)}</p>
    </div>
  )
}

/**
 * Una foto del mosaico: el nombre en Everett sobre la foto, la cantidad al lado.
 * En el teléfono (<640) es una tarjeta chica de un carrusel horizontal (150 px,
 * 3:4: se ven dos y un pedazo de la tercera); desde sm vuelve a la grilla.
 */
function GrupoTile({ grupo, onAbrir }) {
  return (
    <button
      onClick={() => onAbrir(grupo.id)}
      className="relative w-[150px] shrink-0 snap-start aspect-[3/4] rounded-[16px] sm:w-auto sm:aspect-[4/5] sm:rounded-[24px] overflow-hidden text-left bg-bg-surface-hover group"
    >
      <img
        src={grupo.fotoChica}
        alt=""
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
      />
      <div className="absolute inset-x-0 bottom-0 h-[45%] sm:h-2/5 bg-gradient-to-t from-black/45 to-transparent" />
      {/* La cantidad va arriba: abajo no entra al lado de "Antibióticos" a 390 px. */}
      <div className="absolute inset-x-0 top-0 h-12 sm:h-16 bg-gradient-to-b from-black/30 to-transparent" />
      <span className="absolute top-2.5 right-3 text-[12px] sm:top-3.5 sm:right-4 sm:text-[13px] text-white">{grupo.productos.length}</span>
      <span className="absolute inset-x-3 bottom-3 sm:inset-x-5 sm:bottom-4 font-serif font-light text-white text-[17px] sm:text-[26px] leading-[1.15] sm:leading-[1.1]">{grupo.label}</span>
    </button>
  )
}

/**
 * Lo recetado por el médico (C): lo que dice la receta arriba, el producto
 * exacto que la cubre, y el botón al pie. Se muestran las dos cosas porque los
 * nombres del catálogo no son los de la receta — nunca se presenta el producto
 * como si fuera la receta.
 */
function RecetadoCard({ receta, productos, cart, siguientes = [] }) {
  const [principal, ...otros] = productos
  const q = principal ? cart.quantityOf(principal.id) : 0
  const vale = receta.maxEnvases > 1 ? `${receta.maxEnvases} envases` : 'Una compra'
  // Si lo recetado ya es la marca del producto, no se repite (Felipe).
  const primera = (t) => String(t ?? '').trim().split(/\s+/)[0]?.toLowerCase()
  const repite = principal && primera(receta.medicationName) === primera(principal.name)
  return (
    <div className="rounded-[24px] bg-receta-nivel overflow-hidden">
      <div className="p-5 flex flex-col gap-4">
        <p className="text-[14px] text-brand-tertiary-hover leading-snug">
          {repite ? 'Recetado por tu médico' : `Recetado por tu médico · ${receta.medicationName}`}
        </p>
        {principal ? (
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 rounded-[18px] bg-bg-surface flex items-center justify-center overflow-hidden shrink-0">
              {principal.imageUrl
                ? <img src={principal.imageUrl} alt="" className="w-full h-full object-contain p-2" />
                : <ShoppingBag className="w-6 h-6 text-text-tertiary" />}
            </div>
            <div className="min-w-0">
              <p className="font-serif text-[22px] leading-[26px] text-text-primary">{nombreLegible(principal.name)}</p>
              <p className="text-[15px] text-text-secondary mt-1">{fmtPrice(principal.price)}</p>
              <p className="text-[13px] text-text-secondary mt-1 whitespace-nowrap">
                {[vale, receta.venceAt && `hasta el ${ddmm(receta.venceAt)}`].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-[15px] text-text-secondary">La farmacia no lo tiene disponible por ahora.</p>
        )}
        {otros.map(p => {
          const qo = cart.quantityOf(p.id)
          return (
            <div key={p.id} className="flex items-center gap-3">
              <p className="flex-1 min-w-0 text-[14px] text-text-primary leading-snug">{nombreLegible(p.name)} · {fmtPrice(p.price)}</p>
              {qo > 0
                ? <Stepper quantity={qo} onAdd={() => cart.add(p)} onRemove={() => cart.subtract(p)} />
                : <button onClick={() => cart.add(p)} aria-label={`Agregar ${p.name}`} className="w-9 h-9 rounded-full bg-brand-tertiary-hover text-white flex items-center justify-center"><Plus className="w-4 h-4" /></button>}
            </div>
          )
        })}
        {siguientes.length > 0 && (
          <p className="flex items-center gap-1.5 text-[13px] text-text-secondary">
            <ArrowsClockwise className="w-4 h-4 shrink-0" />
            Siguientes: desde el {siguientes.map(r => ddmm(r.emitidaAt)).join(' y el ')}
          </p>
        )}
      </div>
      {principal && (
        q > 0 ? (
          <button
            onClick={cart.openSheet}
            className="w-full py-4 bg-brand-tertiary-hover text-white text-[16px] font-medium flex items-center justify-center gap-2"
          >
            <Check className="w-5 h-5" /> En tu pedido
          </button>
        ) : (
          <button
            onClick={() => cart.add(principal)}
            className="w-full py-4 bg-brand-tertiary-hover hover:bg-brand-tertiary-hover/90 text-white text-[16px] font-medium flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" /> Agregar al pedido
          </button>
        )
      )}
    </div>
  )
}

/**
 * Receta que todavía no se puede comprar: pendiente de autorización de la
 * obra social (migración 223) o posdatada que no empezó (migración 214). Se
 * ve, pero sin botón — la base tampoco la deja agregar.
 */
function RecetaEnEspera({ receta, productos }) {
  const pendiente = receta.estado === 'pendiente'
  return (
    <div className="rounded-[24px] bg-bg-surface p-5 flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {pendiente
          ? <Chapa tono="apagado">Pendiente de autorización</Chapa>
          : <Chapa tono="apagado">Desde el {ddmm(receta.emitidaAt)}</Chapa>}
        {receta.controlada && <Chapa tono="receta" icon={LockSimple}>Controlado</Chapa>}
        {receta.isChronic && <Chapa tono="vigente" icon={ArrowsClockwise}>Tratamiento prolongado</Chapa>}
      </div>
      <div>
        <p className="text-[18px] font-medium text-text-primary leading-snug">{receta.medicationName}</p>
        <p className="text-[14px] text-text-secondary">
          {[receta.profesional, productos[0] && nombreLegible(productos[0].name)].filter(Boolean).join(' · ')}
        </p>
      </div>
      <p className="flex items-center gap-1.5 text-[13px] text-text-secondary">
        <Info className="w-4 h-4 shrink-0" />
        {pendiente
          ? 'Tu obra social todavía no la autorizó. Vas a poder comprarla cuando la autorice.'
          : `La podés usar desde el ${ddmm(receta.emitidaAt)}.`}
      </p>
    </div>
  )
}

/** Cuántos productos muestra "Destacados" en el inicio de la farmacia. */
const DESTACADOS_MAX = 8

/** Mismo criterio que `elegirDestacados` de la app (src/lib/farmaciaGrupos.ts). */
function elegirDestacados(productos) {
  const puntaje = p => (p.featured ? 0 : 2) + (p.imageUrl ? 0 : 1)
  const vistos = new Set()
  return productos
    .filter(p => p.inStock)
    .map((p, i) => [p, i])
    .sort(([a, i], [b, j]) => puntaje(a) - puntaje(b) || i - j)
    .map(([p]) => p)
    .filter(p => { const k = nombreLegible(p.name).toLowerCase(); return !vistos.has(k) && vistos.add(k) })
    .slice(0, DESTACADOS_MAX)
}

function TituloSeccion({ children }) {
  return <h2 className="font-serif font-light text-[28px] leading-[32px] text-text-primary mb-4">{children}</h2>
}

export default function Pharmacy({ profile }) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const grupoId = searchParams.get('grupo')
  const [allProducts, setAllProducts] = useState([])
  const [recetas, setRecetas] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const cart = usePharmacyCart()
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [showStockOnly, setShowStockOnly] = useState(true)
  // 🔴 El filtro "Con foto" ya no existe (2026-11-21): una farmacia no puede
  // esconderle un medicamento a un paciente porque le falta la foto.
  const [prescriptionType, setPrescriptionType] = useState(null) // null = todas
  const [showFilters, setShowFilters] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (!profile?.id) return

    // Sin el "primero atendete" (Mateo, 2026-10-22): la venta libre es para
    // todos y lo que necesita receta lo frena la base producto por producto.
    Promise.all([
      pharmacyService.getAll(),
      pharmacyService.getMisRecetas(),
    ])
      .then(([all, rec]) => {
        setAllProducts(all)
        setRecetas(rec)
      })
      .catch(err => toast.error(err?.message || 'Error al cargar la farmacia'))
      .finally(() => setLoading(false))
  }, [profile?.id])

  // Al volver a la pantalla después de comprar, una receta vigente puede
  // haber pasado a "usada": se recarga cuando un carrito que existía
  // desaparece (pagarlo lo vacía), no en cada "+".
  const carritoPrevio = useRef(cart.orderId)
  useEffect(() => {
    const antes = carritoPrevio.current
    carritoPrevio.current = cart.orderId
    if (!profile?.id || !antes || cart.orderId) return
    pharmacyService.getMisRecetas().then(setRecetas).catch(() => {})
  }, [profile?.id, cart.orderId])

  // Cambiar de página (mosaico ↔ grupo) arranca arriba, como un push.
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [grupoId])

  const productById = useMemo(() => new Map(allProducts.map(p => [p.id, p])), [allProducts])
  const vigentes = useMemo(() => recetas.filter(r => r.estado === 'vigente'), [recetas])
  const pendientesDeAutorizacion = useMemo(() => recetas.filter(r => r.estado === 'pendiente'), [recetas])
  // Posdatadas que todavía no empezaron: no cubren nada. Si la de hoy del
  // mismo medicamento sigue vigente van como una línea dentro de su tarjeta;
  // si no, en una tarjeta propia "Desde el…".
  const proximas = useMemo(() => recetas.filter(r => r.estado === 'proxima')
    .sort((a, b) => String(a.emitidaAt).localeCompare(String(b.emitidaAt))), [recetas])
  const siguientesDe = (r) => proximas.filter(p => p.medicationName === r.medicationName && p.clinicalMedicationId !== r.clinicalMedicationId)
  const proximasSueltas = useMemo(() => {
    const vistas = new Set()
    return proximas.filter(p => {
      if (vigentes.some(v => v.medicationName === p.medicationName) || vistas.has(p.medicationName)) return false
      vistas.add(p.medicationName)
      return true
    })
  }, [proximas, vigentes])
  const anteriores = useMemo(() => recetas.filter(r => r.estado === 'usada' || r.estado === 'vencida'), [recetas])
  // Lo que una receta vigente cubre. Sólo para decidir qué botón mostrar: la
  // regla de verdad la aplica la base al agregar.
  const cubiertos = useMemo(() => new Set(vigentes.flatMap(r => r.productoIds ?? [])), [vigentes])
  const productosDe = (r) => (r.productoIds ?? []).map(id => productById.get(id)).filter(p => p?.inStock)
  // Debajo del mosaico (2026-11-24): primero los que la farmacia marcó como
  // destacados y después el resto, en stock, los que tienen foto antes, sin
  // repetir nombre. Producción no tiene ninguno marcado: sale del resto.
  const destacados = useMemo(() => elegirDestacados(allProducts), [allProducts])

  const tile = (p) => (
    <ProductTile
      key={p.id}
      product={p}
      quantity={cart.quantityOf(p.id)}
      cubierto={cubiertos.has(p.id)}
      onAdd={cart.add}
      onRemove={cart.subtract}
      onPedirReceta={cart.pedirReceta}
    />
  )

  const hayFiltros = !!query || !!selectedCategory || !!prescriptionType || !showStockOnly

  const filteredProducts = useMemo(() => {
    let result = allProducts
    if (query) {
      const q = query.toLowerCase()
      result = result.filter(p => p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q)))
    }
    if (selectedCategory) result = result.filter(p => p.category === selectedCategory)
    if (showStockOnly) result = result.filter(p => p.inStock)
    // Los productos viejos pueden no tener la categoría de venta cargada:
    // cuentan como venta libre, el default de la columna (migración 129).
    if (prescriptionType) result = result.filter(p => (p.prescriptionType ?? 'venta_libre') === prescriptionType)
    return result
  }, [allProducts, query, selectedCategory, showStockOnly, prescriptionType])

  // El mosaico cuenta sólo lo que está en stock: un grupo con todo agotado no
  // se muestra, igual que uno vacío.
  const enStock = useMemo(() => allProducts.filter(p => p.inStock), [allProducts])
  const grupos = useMemo(() => gruposDelMosaico(enStock), [enStock])
  const grupo = grupoId ? grupos.find(g => g.id === grupoId) : null

  const abrirGrupo = (id) => setSearchParams({ grupo: id })

  const barraCarrito = cart.count > 0 && (
    // Barra del carrito — abre la hoja con los productos, no salta al
    // checkout: el paciente quiere revisar qué lleva antes de pagar.
    <div className="fixed bottom-24 left-0 right-0 px-4 z-40 sm:static lg:px-0 sm:pb-4">
      <div className="patient-column">
        <button
          onClick={cart.openSheet}
          className="w-full py-4 rounded-full bg-brand-hover text-white font-medium text-[16px] flex items-center justify-between px-6"
        >
          <span>{cart.count} producto{cart.count !== 1 ? 's' : ''}</span>
          <span>Ver carrito · {fmtPrice(cart.total)}</span>
        </button>
      </div>
    </div>
  )

  const espacioCarrito = cart.count > 0 ? 'pb-44 sm:pb-10' : 'pb-28 sm:pb-10'

  // ── Página de un grupo (push desde el mosaico) ──────────────────────────
  if (grupoId) {
    const productos = grupo?.productos ?? []
    return (
      <div className="absolute inset-0 flex flex-col bg-bg-primary">
        <div ref={scrollRef} className={`flex-1 overflow-y-auto ${espacioCarrito}`}>
          <div className="patient-column sm:pt-6">
            <div className="sm:px-4 lg:px-0">
            <div className="relative h-[340px] sm:h-[360px] sm:rounded-[28px] overflow-hidden bg-bg-surface-hover">
              {/* En pantallas anchas va el recorte apaisado: el vertical, estirado
                  a 960×360, mostraba sólo un pedazo de la foto. */}
              {grupo && (
                <picture>
                  <source media="(min-width: 640px)" srcSet={grupo.fotoAncha} />
                  <img src={grupo.foto} alt="" className="absolute inset-0 w-full h-full object-cover" />
                </picture>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
              <button
                onClick={() => navigate(-1)}
                aria-label="Volver"
                className="absolute top-5 left-4 w-11 h-11 rounded-full bg-white/80 backdrop-blur-[12px] flex items-center justify-center"
              >
                <ArrowLeft className="w-5 h-5 text-text-primary" />
              </button>
              <div className="absolute left-5 right-5 bottom-5 text-white">
                <h1 className="font-serif font-light text-[44px] leading-[46px]">{grupo?.label ?? 'Farmacia'}</h1>
                <p className="text-[15px] text-white/85 mt-1">{productos.length} producto{productos.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            </div>
            <div className="px-4 lg:px-0 pt-6">
              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {[1, 2, 3, 4].map(i => <div key={i} className="aspect-square rounded-[20px] bg-bg-surface-hover animate-pulse" />)}
                </div>
              ) : productos.length === 0 ? (
                <p className="text-text-secondary py-8">Por ahora no hay productos acá.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-6">
                  {productos.map(tile)}
                </div>
              )}
            </div>
          </div>
        </div>
        {barraCarrito}
      </div>
    )
  }

  // ── Inicio de la farmacia ───────────────────────────────────────────────
  const enEspera = [...pendientesDeAutorizacion, ...proximasSueltas]

  return (
    <div className="absolute inset-0 flex flex-col bg-bg-primary">
      <div ref={scrollRef} className={`flex-1 overflow-y-auto ${espacioCarrito}`}>
        <div className="patient-column">
        <div className="px-4 lg:px-0 pt-6">
          <div className="flex items-center justify-between">
            <button onClick={() => navigate(-1)} aria-label="Volver" className="w-11 h-11 rounded-full bg-bg-surface-hover flex items-center justify-center">
              <ArrowLeft className="w-5 h-5 text-text-primary" />
            </button>
            <button onClick={() => navigate('/paciente/farmacia/pedidos')} className="flex items-center gap-1.5 text-[16px] text-brand-hover px-2 py-2 rounded-full hover:bg-brand-muted">
              <Package className="w-5 h-5" /> Mis pedidos
            </button>
          </div>

          <h1 className="font-serif font-light text-[48px] leading-[52px] text-text-primary mt-5">Farmacia</h1>

          <div className="mt-5 flex items-center gap-2">
            <div className="relative flex-1">
              <MagnifyingGlass className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-secondary pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Buscar un medicamento"
                className="w-full h-13 pl-12 pr-4 rounded-full bg-bg-surface-hover text-[16px] text-text-primary placeholder:text-text-secondary outline-none focus:ring-2 focus:ring-brand/40"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              aria-label="Filtros"
              aria-expanded={showFilters}
              className={`relative w-13 h-13 shrink-0 rounded-full flex items-center justify-center ${showFilters ? 'bg-brand-hover text-white' : 'bg-bg-surface-hover text-text-secondary'}`}
            >
              <FunnelSimple className="w-5 h-5" />
              {(!!selectedCategory || !!prescriptionType || !showStockOnly) && !showFilters && (
                <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-brand" />
              )}
            </button>
          </div>

          {showFilters && (
            <div className="mt-3 rounded-[24px] bg-bg-surface p-5 space-y-4">
              <div>
                <p className="text-sm font-semibold text-text-primary mb-2">Categoría</p>
                <div className="flex flex-wrap gap-2">
                  {[{ id: null, label: 'Todas' }, ...CATEGORIAS].map(cat => (
                    <button
                      key={cat.id ?? 'todas'}
                      onClick={() => setSelectedCategory(cat.id === selectedCategory ? null : cat.id)}
                      className={`px-3 py-1.5 rounded-full text-[13px] font-medium ${
                        selectedCategory === cat.id ? 'bg-brand-hover text-white' : 'bg-bg-surface-hover text-text-secondary'
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
                  {[null, ...PRESCRIPTION_TYPES].map(type => (
                    <button
                      key={type ?? 'todas'}
                      onClick={() => setPrescriptionType(type === prescriptionType ? null : type)}
                      className={`px-3 py-1.5 rounded-full text-[13px] font-medium ${
                        prescriptionType === type ? 'bg-brand-hover text-white' : 'bg-bg-surface-hover text-text-secondary'
                      }`}
                    >
                      {type ? PRESCRIPTION_TYPE_PATIENT_LABELS[type] : 'Todas'}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={showStockOnly}
                  onChange={(e) => setShowStockOnly(e.target.checked)}
                  className="w-4 h-4 rounded accent-brand"
                />
                Solo en stock
              </label>
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-6">
              {[1, 2, 3, 4].map(i => <div key={i} className="aspect-[4/5] rounded-[24px] bg-bg-surface-hover animate-pulse" />)}
            </div>
          ) : hayFiltros ? (
            // Buscando o filtrando: una sola grilla, mezclada. Lo que necesita
            // receta y no está cubierto igual muestra "Pedir receta".
            <div className="pt-6">
              {filteredProducts.length === 0 ? (
                <div className="text-center py-12">
                  <ShoppingBag className="h-10 w-10 text-text-tertiary mx-auto mb-3" />
                  <p className="text-text-secondary">{query ? 'No encontramos productos' : 'Sin productos con estos filtros'}</p>
                </div>
              ) : (
                <>
                  <p className="text-[14px] text-text-secondary mb-4">{filteredProducts.length} producto{filteredProducts.length !== 1 ? 's' : ''}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-6">
                    {filteredProducts.map(tile)}
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              {/* ── Lo recetado por el médico (C) ───────────────────────── */}
              {vigentes.length > 0 && (
                <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {vigentes.map(r => (
                    <RecetadoCard
                      key={r.clinicalMedicationId}
                      receta={r}
                      productos={productosDe(r)}
                      cart={cart}
                      siguientes={siguientesDe(r)}
                    />
                  ))}
                </div>
              )}

              {/* ── El mosaico (A) ───────────────────────────────────────── */}
              {/* En el teléfono es un carrusel horizontal que sangra hasta los
                  bordes (-mx-4 px-4) y engancha en cada tarjeta; desde sm, grilla. */}
              <div className="mt-5 -mx-4 px-4 scroll-px-4 flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide sm:mx-0 sm:px-0 sm:grid sm:grid-cols-3 lg:grid-cols-4 sm:overflow-visible">
                {grupos.map(g => <GrupoTile key={g.id} grupo={g} onAbrir={abrirGrupo} />)}
              </div>
              {grupos.length === 0 && (
                <p className="text-text-secondary py-8">Sin productos disponibles.</p>
              )}

              {/* ── Tus recetas: las que todavía no se compran y las viejas ── */}
              {(enEspera.length > 0 || anteriores.length > 0) && (
                <section className="mt-12">
                  <TituloSeccion>Tus recetas</TituloSeccion>
                  {enEspera.length > 0 && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
                      {enEspera.map(r => <RecetaEnEspera key={r.clinicalMedicationId} receta={r} productos={productosDe(r)} />)}
                    </div>
                  )}
                  {anteriores.length > 0 && (
                    <div className="rounded-[24px] bg-bg-surface divide-y divide-bg-primary">
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
                  )}
                </section>
              )}

              {/* ── Destacados ─────────────────────────────────────────── */}
              {destacados.length > 0 && (
                <section className="mt-12">
                  <TituloSeccion>Destacados</TituloSeccion>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-6">
                    {destacados.map(tile)}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
        </div>
      </div>
      {barraCarrito}
    </div>
  )
}
