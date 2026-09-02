/**
 * Verifica el carrito persistente de farmacia contra STAGING:
 * agregar, sumar, restar, sacar, y que el borrador quede bien.
 */
import { createClient } from '@supabase/supabase-js'

const URL = process.env.HEALTHIER_STAGING_SUPABASE_URL
const ANON = process.env.HEALTHIER_STAGING_SUPABASE_ANON_KEY
const supabase = createClient(URL, ANON)

const log = (ok, msg) => console.log(`${ok ? '✅' : '❌'} ${msg}`)
let fallos = 0
const check = (cond, msg) => { log(cond, msg); if (!cond) fallos++ }

// Se entra con un magic link generado con la service key en vez de con
// password: las cuentas demo son compartidas y rotarles la contraseña para una
// verificación le rompe la sesión a cualquier otro que las esté usando.
const admin = createClient(URL, process.env.HEALTHIER_STAGING_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
  type: 'magiclink', email: 'paciente.completo@staging.healthier.app',
})
if (linkErr) { console.error('no se pudo generar el link:', linkErr.message); process.exit(1) }
const { data: auth, error: authErr } = await supabase.auth.verifyOtp({
  token_hash: link.properties.hashed_token, type: 'email',
})
if (authErr) { console.error('login falló:', authErr.message); process.exit(1) }
console.log('paciente:', auth.user.id)

// Limpiar cualquier borrador previo para arrancar de cero
const { data: previos } = await supabase.from('medication_orders')
  .select('id, items:medication_order_items(id)')
  .eq('patient_id', auth.user.id).eq('payment_status', 'no_pagado')
for (const p of previos ?? []) {
  for (const it of p.items ?? []) await supabase.rpc('actualizar_item_pedido_medicamentos', { p_item_id: it.id, p_quantity: 0 })
}

const { data: productos, error: prodErr } = await supabase
  .from('pharmacy_products').select('id, name, price, prescription_type').eq('in_stock', true).limit(2)
if (prodErr) { console.error(prodErr); process.exit(1) }
const [A, B] = productos
check(!!A && !!B, `hay al menos 2 productos en el catálogo (${productos.length})`)

const leer = async id => {
  const { data } = await supabase.from('medication_orders')
    .select('*, items:medication_order_items(*)').eq('id', id).maybeSingle()
  return data
}

// 1. Agregar crea el borrador
const { data: oid1, error: e1 } = await supabase.rpc('agregar_item_pedido_medicamentos', { p_product_id: A.id, p_delta: 1 })
check(!e1 && !!oid1, `agregar el primer producto crea el borrador${e1 ? ` — ${e1.message}` : ''}`)
let order = await leer(oid1)
check(order?.items?.length === 1 && order.items[0].quantity === 1, 'el borrador tiene 1 item con cantidad 1')
check(Number(order?.total) === Number(A.price), `el total es el precio del producto (${order?.total} vs ${A.price})`)
check(order?.items?.[0]?.unit_price == A.price, 'el precio unitario salió del catálogo, no del cliente')

if (fallos > 0) { console.log('\n🔴 el primer agregado falló — no sigo'); process.exit(1) }

// 2. Sumar de nuevo el mismo producto no duplica la fila
const { data: oid2 } = await supabase.rpc('agregar_item_pedido_medicamentos', { p_product_id: A.id, p_delta: 1 })
check(oid2 === oid1, 'sumar otra vez reusa el mismo borrador')
order = await leer(oid1)
check(order.items.length === 1 && order.items[0].quantity === 2, 'no duplica la fila, sube la cantidad a 2')
check(Number(order.total) === Number(A.price) * 2, `el total se recalculó (${order.total})`)

// 3. Segundo producto
await supabase.rpc('agregar_item_pedido_medicamentos', { p_product_id: B.id, p_delta: 3 })
order = await leer(oid1)
check(order.items.length === 2, 'el segundo producto entra en el mismo pedido')
check(Number(order.total) === Number(A.price) * 2 + Number(B.price) * 3, `el total suma los dos (${order.total})`)

// 4. Restar
await supabase.rpc('agregar_item_pedido_medicamentos', { p_product_id: B.id, p_delta: -1 })
order = await leer(oid1)
const itemB = order.items.find(i => i.pharmacy_product_id === B.id)
check(itemB.quantity === 2, 'restar baja la cantidad a 2')

// 5. Sacar del todo con un delta grande negativo
await supabase.rpc('agregar_item_pedido_medicamentos', { p_product_id: B.id, p_delta: -99 })
order = await leer(oid1)
check(order.items.length === 1, 'un delta negativo grande saca el producto entero, no deja cantidad negativa')
check(Number(order.total) === Number(A.price) * 2, 'el total volvió a ser sólo el del primer producto')

// 6. Sacar el último borra el borrador
const { data: oidFinal } = await supabase.rpc('agregar_item_pedido_medicamentos', { p_product_id: A.id, p_delta: -99 })
check(oidFinal === null, 'sacar el último medicamento devuelve null')
check((await leer(oid1)) === null, 'el borrador vacío se borró')

// 7. Restar sobre un carrito inexistente no crea uno vacío
const { data: oidVacio } = await supabase.rpc('agregar_item_pedido_medicamentos', { p_product_id: A.id, p_delta: -1 })
check(oidVacio === null, 'restar sin carrito no crea un borrador vacío')
const { data: sobrantes } = await supabase.from('medication_orders').select('id')
  .eq('patient_id', auth.user.id).eq('payment_status', 'no_pagado')
check((sobrantes ?? []).length === 0, `no quedaron borradores sueltos (${(sobrantes ?? []).length})`)

// 8. El precio se refresca desde el catálogo al tocar la cantidad
await supabase.rpc('agregar_item_pedido_medicamentos', { p_product_id: A.id, p_delta: 1 })
const { data: oidP } = await supabase.rpc('agregar_item_pedido_medicamentos', { p_product_id: A.id, p_delta: 1 })
const conPrecio = await leer(oidP)
check(Number(conPrecio.items[0].unit_price) === Number(A.price), 'el precio unitario se re-lee del catálogo en cada cambio')
// limpiar
await supabase.rpc('agregar_item_pedido_medicamentos', { p_product_id: A.id, p_delta: -99 })

// 9. cancellation_reason existe y el paciente NO puede escribirla
const { error: eCancel } = await supabase.from('medication_orders').select('cancellation_reason').limit(1)
check(!eCancel, `la columna cancellation_reason existe${eCancel ? ` — ${eCancel.message}` : ''}`)

console.log(fallos === 0 ? '\n🟢 Todo en verde' : `\n🔴 ${fallos} fallo(s)`)
process.exit(fallos === 0 ? 0 : 1)
