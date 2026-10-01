import { useState, useEffect, useRef, useMemo } from 'react'
import { UploadSimple, DownloadSimple, ShoppingBag, Lock, ImageBroken, X } from '@phosphor-icons/react'
import { pharmacyAdminService } from '../../services/pharmacyAdminService'
import { parseCatalogFile, validateRows, buildCatalogWorkbook, PRESCRIPTION_TYPE_LABELS } from '../../lib/pharmacyExcel'
import { toast } from '../../components/Toast'
import { formatARS } from '../../lib/format'

// Que haya `image_url` no quiere decir que la foto se vea: parte del catálogo
// apunta a links de un banco de imágenes que hoy dan 404. Por eso el estado de
// cada foto se prueba de verdad, cargándola, y no se mira sólo si el campo está
// vacío. Cada producto queda en 'ok', 'rota' o 'falta' (sin link); mientras
// carga no tiene entrada.
function useEstadoFotos(products) {
  const [estado, setEstado] = useState({})
  useEffect(() => {
    let vivo = true
    const inicial = {}
    const sondas = []
    for (const p of products) {
      if (!p.imageUrl) { inicial[p.id] = 'falta'; continue }
      const img = new Image()
      img.onload = () => vivo && setEstado(prev => ({ ...prev, [p.id]: 'ok' }))
      img.onerror = () => vivo && setEstado(prev => ({ ...prev, [p.id]: 'rota' }))
      img.src = p.imageUrl
      sondas.push(img)
    }
    setEstado(inicial)
    return () => {
      vivo = false
      for (const img of sondas) { img.onload = null; img.onerror = null }
    }
  }, [products])
  return [estado, setEstado]
}

function Miniatura({ product, estado, onFalla }) {
  const sinFoto = estado === 'falta' || estado === 'rota'
  if (sinFoto) {
    return (
      <div
        className="w-10 h-10 shrink-0 rounded-lg border border-dashed border-border-default bg-bg-surface flex flex-col items-center justify-center text-text-tertiary"
        title={estado === 'rota' ? 'La foto no carga (el link está roto)' : 'Este producto no tiene foto'}
      >
        <ImageBroken className="w-3.5 h-3.5" />
        <span className="text-[8px] leading-tight font-medium mt-0.5">Sin foto</span>
      </div>
    )
  }
  return (
    <div className="w-10 h-10 shrink-0 rounded-lg border border-border-default bg-bg-surface overflow-hidden">
      {estado === 'ok' && (
        <img
          src={product.imageUrl}
          alt={product.name}
          className="w-full h-full object-cover"
          onError={onFalla}
        />
      )}
    </div>
  )
}

export default function PharmacyCatalog({ profile }) {
  const [products, setProducts] = useState([])
  const [soloSinFoto, setSoloSinFoto] = useState(false)
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState(null) // { validRows, errors }
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef(null)

  const isAdmin = profile?.role === 'pharmacy_admin'

  const load = () => {
    setLoading(true)
    pharmacyAdminService.getCatalog()
      .then(setProducts)
      .catch(() => toast.error('Error al cargar el catálogo'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const [estadoFotos, setEstadoFotos] = useEstadoFotos(products)
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
                        onFalla={() => setEstadoFotos(prev => ({ ...prev, [p.id]: 'rota' }))}
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
