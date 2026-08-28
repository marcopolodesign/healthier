/**
 * pharmacyExcel.js — bidirectional Excel round-trip for the pharmacy
 * catalog. Headers are Spanish, matching the spec verbatim.
 *
 * xlsx (SheetJS) is dynamically imported inside each function rather than
 * statically at module scope — this file is imported from the main App.jsx
 * route table, and the library is large but only ever needed by a
 * pharmacy_admin opening Catálogo, not by every visitor's initial bundle.
 */

const HEADERS = ['SKU', 'Nombre', 'Presentación', 'Precio', 'Stock', 'Categoría receta', 'Disponible']

const PRESCRIPTION_TYPE_LABELS = {
  venta_libre: 'Venta libre',
  receta: 'Receta',
  receta_archivada: 'Receta archivada',
}
const PRESCRIPTION_TYPES = Object.keys(PRESCRIPTION_TYPE_LABELS)
const LABEL_TO_PRESCRIPTION_TYPE = Object.fromEntries(
  Object.entries(PRESCRIPTION_TYPE_LABELS).map(([type, label]) => [label.toUpperCase(), type])
)

function toBool(v) {
  if (typeof v === 'boolean') return v
  const s = String(v ?? '').trim().toUpperCase()
  return s === 'SI' || s === 'SÍ' || s === 'TRUE' || s === '1'
}

/** Maps a free-text cell to one of the 3 prescription categories, or null if unrecognized. */
function toPrescriptionType(v) {
  const s = String(v ?? '').trim().toUpperCase()
  return LABEL_TO_PRESCRIPTION_TYPE[s] ?? null
}

export { PRESCRIPTION_TYPE_LABELS, PRESCRIPTION_TYPES }

/** Reads a File (.xlsx) and returns raw rows mapped to our field names. */
export async function parseCatalogFile(file) {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: null })

  return raw.map((row, i) => ({
    _row: i + 2, // header is row 1
    sku: row['SKU'] != null ? String(row['SKU']).trim() : null,
    nombre: row['Nombre'] != null ? String(row['Nombre']).trim() : null,
    presentacion: row['Presentación'] != null ? String(row['Presentación']).trim() : null,
    precio: row['Precio'],
    stock: row['Stock'],
    prescriptionType: toPrescriptionType(row['Categoría receta']),
    disponible: toBool(row['Disponible']),
  }))
}

/** Validates parsed rows, returns { validRows, errors }. Never imports a bad row silently. */
export function validateRows(rows) {
  const errors = []
  const seenSku = new Set()

  const validRows = rows.filter(row => {
    const rowErrors = []
    if (!row.nombre) rowErrors.push('Nombre vacío')
    if (row.sku) {
      if (seenSku.has(row.sku)) rowErrors.push(`SKU duplicado en el archivo: ${row.sku}`)
      seenSku.add(row.sku)
    }
    const precio = Number(row.precio)
    if (row.precio == null || Number.isNaN(precio) || precio < 0) rowErrors.push('Precio inválido')
    const stock = Number(row.stock)
    if (row.stock == null || Number.isNaN(stock) || stock < 0 || !Number.isInteger(stock)) rowErrors.push('Stock inválido')
    if (!row.prescriptionType) {
      rowErrors.push(`Categoría receta inválida — usar: ${PRESCRIPTION_TYPES.map(t => PRESCRIPTION_TYPE_LABELS[t]).join(' / ')}`)
    }

    if (rowErrors.length) {
      errors.push({ row: row._row, field: rowErrors.join('; '), message: `Fila ${row._row}: ${rowErrors.join('; ')}` })
      return false
    }
    return true
  }).map(row => ({ ...row, precio: Number(row.precio), stock: Number(row.stock) }))

  return { validRows, errors }
}

/** Builds and triggers a download of the current catalog as .xlsx. rows = pharmacyAdminService.exportCatalogRows() output. */
export async function buildCatalogWorkbook(rows) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.json_to_sheet(rows, { header: HEADERS })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Catálogo')
  const date = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `catalogo-farmacia-${date}.xlsx`)
}
