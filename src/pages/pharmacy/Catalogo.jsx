import { useState, useEffect, useRef, useMemo } from 'react'
import { UploadSimple, DownloadSimple, ShoppingBag, Lock, ImageBroken, X, Camera, CircleNotch } from '@phosphor-icons/react'
import { pharmacyAdminService, PRODUCT_IMAGE_MAX_BYTES } from '../../services/pharmacyAdminService'
import { parseCatalogFile, validateRows, buildCatalogWorkbook, PRESCRIPTION_TYPE_LABELS } from '../../lib/pharmacyExcel'
import { toast } from '../../components/Toast'
import { formatARS } from '../../lib/format'

// Que haya `image_url` no quiere decir que la foto se vea: parte del catálogo
// apunta a links de un banco de imágenes que hoy dan 404. Por eso el estado de
// cada foto se prueba de verdad, cargándola, y no se mira sólo si el campo está
// vacío. Cada producto queda en 'ok', 'rota' o 'falta' (sin link); mientras
// carga no tiene entrada. El resultado se guarda por URL: cuando la farmacia
// sube una foto nueva sólo se prueba ésa, no el catálogo entero.
function useEstadoFotos(products) {
  const [porUrl, setPorUrl] = useState({})
  const probadas = useRef(new Set())
  useEffect(() => {
    for (const p of products) {
      const url = p.imageUrl
      if (!url || probadas.current.has(url)) continue
      probadas.current.add(url)
      const img = new Image()
      img.onload = () => setPorUrl(prev => ({ ...prev, [url]: 'ok' }))
      img.onerror = () => setPorUrl(prev => ({ ...prev, [url]: 'rota' }))
      img.src = url
    }
  }, [products])
  const estado = useMemo(() => {
    const e = {}
    for (const p of products) e[p.id] = p.imageUrl ? porUrl[p.imageUrl] : 'falta'
    return e
  }, [products, porUrl])
  const marcarRota = (url) => setPorUrl(prev => ({ ...prev, [url]: 'rota' }))
  return [estado, marcarRota]
}

function Miniatura({ product, estado, onFalla, onSubir, subiendo }) {
  const sinFoto = estado === 'falta' || estado === 'rota'
  const accion = sinFoto ? 'Subir foto' : 'Cambiar foto'
  const detalle = estado === 'rota' ? 'La foto no carga (el link está roto). ' : estado === 'falta' ? 'Este producto no tiene foto. ' : ''
  return (
    <button
      type="button"
      onClick={onSubir}
      disabled={subiendo}
      title={`${detalle}${accion}`}
      aria-label={`${accion} de ${product.name}`}
      className={`group relative w-10 h-10 shrink-0 rounded-lg border bg-bg-surface overflow-visible cursor-pointer disabled:cursor-wait ${
        sinFoto ? 'border-dashed border-border-default' : 'border-border-default'
      }`}
    >
      <span className="absolute inset-0 rounded-lg overflow-hidden flex flex-col items-center justify-center text-text-tertiary">
        {sinFoto ? (
          <>
            <ImageBroken className="w-3.5 h-3.5" />
            <span className="text-[8px] leading-tight font-medium mt-0.5">Sin foto</span>
          </>
        ) : estado === 'ok' ? (
          <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" onError={onFalla} />
        ) : null}
        {subiendo && (
          <span className="absolute inset-0 bg-bg-secondary/80 flex items-center justify-center">
            <CircleNotch className="w-4 h-4 text-brand animate-spin" />
          </span>
        )}
      </span>
      {!subiendo && (
        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-brand text-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
          <Camera className="w-2.5 h-2.5" weight="bold" />
        </span>
      )}
    </button>
  )
}

export default function PharmacyCatalog({ profile }) {
  const [products, setProducts] = useState([])
  const [soloSinFoto, setSoloSinFoto] = useState(false)
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState(null) // { validRows, errors }
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef(null)
  const fotoInputRef = useRef(null)
  const fotoDestino = useRef(null)
  const [subiendoId, setSubiendoId] = useState(null)

  const isAdmin = profile?.role === 'pharmacy_admin'

  const load = () => {
    setLoading(true)
    pharmacyAdminService.getCatalog()
      .then(setProducts)
      .catch(() => toast.error('Error al cargar el catálogo'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const [estadoFotos, marcarRota] = useEstadoFotos(products)
  const revisando = products.some(p => !estadoFotos[p.id])
  const sinFoto = useMemo(
    () => products.filter(p => estadoFotos[p.id] === 'falta' || estadoFotos[p.id] === 'rota'),
    [products, estadoFotos],
  )
  const visibles = soloSinFoto && sinFoto.length > 0 ? sinFoto : products

  if (!isAdmin) {
    return (
      <div className="space-y-6 animate-fade-in">
        <h1 className="text-2xl font-bold text-text-primary">Catálogo</h1>
        <div className="card text-center py-16">
          <Lock className="h-10 w-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-secondary">Solo el Administrador puede editar el catálogo.</p>
        </div>
      </div>
    )
  }

  const elegirFoto = (productId) => {
    fotoDestino.current = productId
    fotoInputRef.current?.click()
  }

  const handleFoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const productId = fotoDestino.current
    if (!file || !productId) return
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      toast.error(`La foto pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo es 5 MB.`)
      return
    }
    setSubiendoId(productId)
    try {
      const actualizado = await pharmacyAdminService.uploadProductImage(productId, file)
      setProducts(prev => prev.map(p => (p.id === productId ? { ...p, ...actualizado } : p)))
      toast.success(`Foto guardada: ${actualizado.name}`)
    } catch (err) {
      toast.error(err?.message || String(err))
    } finally {
      setSubiendoId(null)
    }
  }

  const handleExport = async () => {
    try {
      const rows = await pharmacyAdminService.exportCatalogRows()
      await buildCatalogWorkbook(rows)
      toast.success('Catálogo exportado')
    } catch {
      toast.error('Error al exportar el catálogo')
    }
  }

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const rows = await parseCatalogFile(file)
      const { validRows, errors } = validateRows(rows)
      setPreview({ validRows, errors })
    } catch {
      toast.error('No se pudo leer el archivo — confirmá que sea un .xlsx válido')
    } finally {
      e.target.value = ''
    }
  }

  const confirmImport = async () => {
    if (!preview?.validRows?.length) return
    setImporting(true)
    try {
      const summary = await pharmacyAdminService.bulkUpsertFromImport(preview.validRows)
      toast.success(`Importación completa: ${summary.inserted} nuevos, ${summary.updated} actualizados`)
      setPreview(null)
      load()
    } catch {
      toast.error('Error al importar el catálogo')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Catálogo</h1>
          <p className="text-text-secondary mt-1">{products.length} producto{products.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary flex items-center gap-1.5" onClick={handleExport}>
            <DownloadSimple className="h-4 w-4" /> Exportar Excel
          </button>
          <button className="btn-primary flex items-center gap-1.5" onClick={() => fileInputRef.current?.click()}>
            <UploadSimple className="h-4 w-4" /> Importar Excel
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFile} />
          <input ref={fotoInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFoto} />
        </div>
      </div>

      {preview && (
        <div className="card space-y-3 border-brand/30">
          <p className="font-semibold text-text-primary">
            Vista previa: {preview.validRows.length} fila{preview.validRows.length !== 1 ? 's' : ''} válida{preview.validRows.length !== 1 ? 's' : ''}
            {preview.errors.length > 0 && `, ${preview.errors.length} con error`}
          </p>
          {preview.errors.length > 0 && (
            <ul className="text-sm text-danger space-y-0.5 max-h-32 overflow-y-auto">
              {preview.errors.map((e, i) => <li key={i}>{e.message}</li>)}
            </ul>
          )}
          <div className="flex gap-2">
            <button className="btn-primary" disabled={importing || !preview.validRows.length} onClick={confirmImport}>
              {importing ? 'Importando...' : 'Confirmar importación'}
            </button>
            <button className="btn-secondary" onClick={() => setPreview(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {!loading && products.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {revisando && sinFoto.length === 0 ? (
            <span className="text-sm text-text-tertiary">Revisando fotos…</span>
          ) : sinFoto.length === 0 ? (
            <span className="text-sm text-text-secondary">Todos los productos tienen foto</span>
          ) : (
            <button
              type="button"
              onClick={() => setSoloSinFoto(v => !v)}
              aria-pressed={soloSinFoto}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                soloSinFoto
                  ? 'bg-brand text-white border-brand'
                  : 'bg-bg-secondary text-text-primary border-border-default hover:bg-bg-surface'
              }`}
            >
              <ImageBroken className="h-4 w-4" />
              {sinFoto.length} producto{sinFoto.length !== 1 ? 's' : ''} sin foto
              {revisando && '…'}
              {soloSinFoto && <X className="h-3.5 w-3.5" />}
            </button>
          )}
          {soloSinFoto && (
            <span className="text-sm text-text-tertiary">Mostrando sólo los productos sin foto</span>
          )}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-12 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : products.length === 0 ? (
          <div className="text-center py-16">
            <ShoppingBag className="h-12 w-12 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary">Catálogo vacío — importá un Excel para empezar</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">SKU</th>
                <th className="table-header">Nombre</th>
                <th className="table-header hidden md:table-cell">Presentación</th>
                <th className="table-header">Precio</th>
                <th className="table-header">Stock</th>
                <th className="table-header hidden sm:table-cell">Categoría receta</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(p => (
                <tr key={p.id} className="table-row">
                  <td className="table-cell font-mono text-xs text-text-secondary">{p.sku || '—'}</td>
                  <td className="table-cell font-medium text-text-primary">
                    <div className="flex items-center gap-3 min-w-[10rem]">
                      <Miniatura
                        product={p}
                        estado={estadoFotos[p.id]}
                        onFalla={() => marcarRota(p.imageUrl)}
                        onSubir={() => elegirFoto(p.id)}
                        subiendo={subiendoId === p.id}
                      />
                      <span>{p.name}</span>
                    </div>
                  </td>
                  <td className="table-cell max-md:hidden text-text-secondary">{p.presentation || '—'}</td>
                  <td className="table-cell">{formatARS(p.price)}</td>
                  <td className="table-cell">{p.stockQuantity}</td>
                  <td className="table-cell max-sm:hidden">{PRESCRIPTION_TYPE_LABELS[p.prescriptionType] ?? PRESCRIPTION_TYPE_LABELS.venta_libre}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}
