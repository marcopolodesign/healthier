import { useState, useEffect, useRef } from 'react'
import { UploadSimple, DownloadSimple, ShoppingBag, Lock } from '@phosphor-icons/react'
import { pharmacyAdminService } from '../../services/pharmacyAdminService'
import { parseCatalogFile, validateRows, buildCatalogWorkbook, PRESCRIPTION_TYPE_LABELS } from '../../lib/pharmacyExcel'
import { toast } from '../../components/Toast'
import { formatARS } from '../../lib/format'

export default function PharmacyCatalog({ profile }) {
  const [products, setProducts] = useState([])
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
        <div className="flex gap-2">
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

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-12 bg-bg-surface rounded-lg animate-pulse" />)}</div>
        ) : products.length === 0 ? (
          <div className="text-center py-16">
            <ShoppingBag className="h-12 w-12 text-text-muted mx-auto mb-3" />
            <p className="text-text-secondary">Catálogo vacío — importá un Excel para empezar</p>
          </div>
        ) : (
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
              {products.map(p => (
                <tr key={p.id} className="table-row">
                  <td className="table-cell font-mono text-xs text-text-secondary">{p.sku || '—'}</td>
                  <td className="table-cell font-medium text-text-primary">{p.name}</td>
                  <td className="table-cell hidden md:table-cell text-text-secondary">{p.presentation || '—'}</td>
                  <td className="table-cell">{formatARS(p.price)}</td>
                  <td className="table-cell">{p.stockQuantity}</td>
                  <td className="table-cell hidden sm:table-cell">{PRESCRIPTION_TYPE_LABELS[p.prescriptionType] ?? PRESCRIPTION_TYPE_LABELS.venta_libre}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
