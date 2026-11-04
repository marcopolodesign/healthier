// Control: la farmacia puede re-importar su catálogo (Importar Excel).
// Con la sesión de farmacia@staging.healthier.app actualiza un producto
// existente por id con sus mismos valores — el camino que usa
// bulkUpsertFromImport — y falla si la base lo rechaza o no toca la fila.
// Antes se usaba upsert(onConflict: 'sku') y con RLS daba 23505 (pkey).
// Uso: node scripts/verificar-importar-catalogo.mjs  (lee ~/Local/.env)
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import os from 'os'
const env = Object.fromEntries(fs.readFileSync(`${os.homedir()}/Local/.env`, 'utf8').split('\n')
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]))
const url = env.HEALTHIER_STAGING_SUPABASE_URL
const admin = createClient(url, env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY)
const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email: 'farmacia@staging.healthier.app' })
if (le) throw le
const sb = createClient(url, env.HEALTHIER_STAGING_SUPABASE_ANON_KEY)
const { error: ve } = await sb.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token })
if (ve) throw ve
const PH = '10000000-0000-0000-0000-000000000001'
const { data: [p], error: se } = await sb.from('pharmacy_products').select('*').eq('pharmacy_id', PH).not('sku', 'is', null).limit(1)
if (se || !p) { console.error('❌ no se pudo leer el catálogo', se?.message); process.exit(1) }
const { data, error } = await sb.from('pharmacy_products')
  .update({ pharmacy_id: PH, sku: p.sku, name: p.name, presentation: p.presentation, price: p.price, stock_quantity: p.stock_quantity, prescription_type: p.prescription_type })
  .eq('id', p.id).select('id')
if (error || !data?.length) { console.error('❌ la farmacia no puede re-importar:', error?.message ?? 'sin filas'); process.exit(1) }
console.log(`✅ re-importación como farmacia OK (${p.sku})`)
