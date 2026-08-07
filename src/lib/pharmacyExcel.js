/**
 * pharmacyExcel.js — bidirectional Excel round-trip for the pharmacy
 * catalog. Headers are Spanish, matching the spec verbatim.
 */
import * as XLSX from 'xlsx'

const HEADERS = ['SKU', 'Nombre', 'Presentación', 'Precio', 'Stock', 'Requiere receta', 'Disponible']

function toBool(v) {
  if (typeof v === 'boolean') return v
  const s = String(v ?? '').trim().toUpperCase()
  return s === 'SI' || s === 'SÍ' || s === 'TRUE' || s === '1'
}

/** Reads a File (.xlsx) and returns raw rows mapped to our field names. */
export async function parseCatalogFile(file) {
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
    requiereReceta: toBool(row['Requiere receta']),
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

    if (rowErrors.length) {
      errors.push({ row: row._row, field: rowErrors.join('; '), message: `Fila ${row._row}: ${rowErrors.join('; ')}` })
      return false
    }
    return true
  }).map(row => ({ ...row, precio: Number(row.precio), stock: Number(row.stock) }))

  return { validRows, errors }
}

/** Builds and triggers a download of the current catalog as .xlsx. rows = pharmacyAdminService.exportCatalogRows() output. */
export function buildCatalogWorkbook(rows) {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: HEADERS })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Catálogo')
  const date = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `catalogo-farmacia-${date}.xlsx`)
}
