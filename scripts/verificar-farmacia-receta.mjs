#!/usr/bin/env node
// verificar-farmacia-receta — el control de "nadie compra con receta sin tenerla"
// (migración 214). Lo arreglado no vuelve: si una migración futura reescribe
// agregar_item_pedido_medicamentos, borra un trigger o reabre una policy, esto
// se pone en rojo.
//
//   node scripts/verificar-farmacia-receta.mjs            # staging (default)
//
// Cada caso corre en una transacción que termina en ROLLBACK, contra STAGING
// por la Management API: arma su propio producto, consulta y receta, prueba,
// y no deja nada. Nunca contra producción.
//
// Necesita en ~/Local/.env: SUPABASE_ACCESS_TOKEN y HEALTHIER_STAGING_SUPABASE_REF.
import fs from 'node:fs'
import os from 'node:os'

const env = Object.fromEntries(
  fs.readFileSync(`${os.homedir()}/Local/.env`, 'utf8').split('\n')
    .filter(l => /^[A-Z0-9_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]),
)
const REF = env.HEALTHIER_STAGING_SUPABASE_REF
const TOKEN = env.SUPABASE_ACCESS_TOKEN
if (!REF || !TOKEN) { console.error('Faltan HEALTHIER_STAGING_SUPABASE_REF / SUPABASE_ACCESS_TOKEN'); process.exit(2) }

// Cuentas de staging: paciente@healthier.app y la Dra. demo (00000001…).
const PACIENTE = 'ede3027e-e586-4e65-8b52-d7c44117a0c1'
const PRO = '00000001-0000-0000-0000-000000000001'
const PROD_A = 'fa214fff-0000-4000-8000-00000000000a' // Clonazepam 2 mg x 30 (lo recetado)
const PROD_B = 'fa214fff-0000-4000-8000-00000000000b' // Clonazepam 0,5 mg x 30 (otra dosis)
const RX = 'fa214fff-0000-4000-8000-0000000000c1'

const comoServicio = `select set_config('request.jwt.claims', '{"role":"service_role"}', true);`
const como = (uid) => `set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);`
const reset = `reset role;`

const preparar = `
  ${comoServicio}
  insert into pharmacy_products (id, name, category, price, medication_match, prescription_type, stock_quantity, pharmacy_id)
  values ('${PROD_A}', 'Prueba Clonazepam 2 mg x 30', 'clinica', 100, 'clonazepam', 'venta_libre', 10, '10000000-0000-0000-0000-000000000001'),
         ('${PROD_B}', 'Prueba Clonazepam 0.5 mg x 30', 'clinica', 100, 'clonazepam', 'venta_libre', 10, '10000000-0000-0000-0000-000000000001');
  insert into consultations (patient_id, professional_id, status, modality, scheduled_at)
  values ('${PACIENTE}', '${PRO}', 'completed', 'video', now() - interval '2 days');
  alter table clinical_medications disable trigger clinical_medications_avisar_receta;
  alter table clinical_medications disable trigger clinical_medications_mail_receta;
  alter table clinical_medications disable trigger verificar_que_puede_recetar;
  insert into clinical_medications (id, patient_id, professional_id, professional_license_type, professional_license_number,
    medication_name, presentation, dosage_text, rcta_status, rcta_prescription_id, rcta_issued_at, status, quantity)
  values ('${RX}', '${PACIENTE}', '${PRO}', 'MN', '1', 'Clonazepam 2 mg', 'x 30', 'x', 'issued', 'prueba-214', now(), 'active', '30 comprimidos');
  -- Vacía el carrito real del paciente dentro de la transacción (vuelve con el rollback).
  delete from medication_orders where patient_id = '${PACIENTE}' and payment_status = 'no_pagado' and status = 'pendiente';
`

const CASOS = [
  {
    nombre: 'El catálogo no puede tener un psicotrópico como venta libre',
    sql: `${preparar} select prescription_type as r from pharmacy_products where id = '${PROD_A}';`,
    espera: { valor: 'receta_archivada' },
  },
  {
    nombre: 'Con receta vigente, el producto exacto entra al carrito',
    sql: `${preparar} ${como(PACIENTE)} select (agregar_item_pedido_medicamentos('${PROD_A}', 1) is not null)::text as r;`,
    espera: { valor: 'true' },
  },
  {
    nombre: '"30 comprimidos" es UN envase, no 30',
    sql: `${preparar} ${como(PACIENTE)} select agregar_item_pedido_medicamentos('${PROD_A}', 2);`,
    espera: { error: 'HR003' },
  },
  {
    nombre: 'Otra dosis de la misma droga NO está cubierta',
    sql: `${preparar} ${como(PACIENTE)} select agregar_item_pedido_medicamentos('${PROD_B}', 1);`,
    espera: { error: 'HR001' },
  },
  {
    nombre: 'Una receta ya usada en un pedido pagado no se vuelve a usar',
    sql: `${preparar} ${como(PACIENTE)} select agregar_item_pedido_medicamentos('${PROD_A}', 1);
          ${reset} ${comoServicio} update medication_orders set payment_status = 'pagado' where patient_id = '${PACIENTE}' and payment_status = 'no_pagado';
          ${como(PACIENTE)} select agregar_item_pedido_medicamentos('${PROD_A}', 1);`,
    espera: { error: 'HR001' },
  },
  {
    nombre: 'Una receta vencida no se puede pagar (exento) aunque ya esté en el carrito',
    sql: `${preparar} update profiles set payment_exempt = true where id = '${PACIENTE}';
          ${como(PACIENTE)} select agregar_item_pedido_medicamentos('${PROD_A}', 1);
          ${reset} ${comoServicio} update clinical_medications set rcta_issued_at = now() - interval '40 days' where id = '${RX}';
          ${como(PACIENTE)} update medication_orders set payment_status = 'exento' where patient_id = '${PACIENTE}' and payment_status = 'no_pagado';`,
    espera: { error: 'HR002' },
  },
  {
    nombre: 'mp-payment ve el pedido con receta vencida como no cobrable',
    sql: `${preparar} ${como(PACIENTE)} select agregar_item_pedido_medicamentos('${PROD_A}', 1);
          ${reset} ${comoServicio} update clinical_medications set rcta_issued_at = now() - interval '40 days' where id = '${RX}';
          select count(*)::text as r from farmacia_items_sin_receta((select id from medication_orders where patient_id = '${PACIENTE}' and payment_status = 'no_pagado'));`,
    espera: { valor: '1' },
  },
  {
    nombre: 'El paciente no puede insertar un item a mano (ni siquiera de venta libre: el precio lo pone la base)',
    sql: `${preparar} ${como(PACIENTE)} select agregar_item_pedido_medicamentos((select id from pharmacy_products where prescription_type = 'venta_libre' and in_stock limit 1), 1);
          insert into medication_order_items (order_id, pharmacy_product_id, medication_name, quantity, unit_price)
          select id, (select id from pharmacy_products where prescription_type = 'venta_libre' and in_stock limit 1), 'x', 1, 1
            from medication_orders where patient_id = '${PACIENTE}' and payment_status = 'no_pagado';`,
    espera: { error: '42501' },
  },
  {
    nombre: 'Un profesional no puede marcar una receta como emitida a mano',
    sql: `${preparar} ${como(PRO)} insert into clinical_medications (patient_id, professional_id, professional_license_type, professional_license_number, medication_name, dosage_text, rcta_status)
          values ('${PACIENTE}', '${PRO}', 'MN', '1', 'Clonazepam 0.5 mg x 30', 'x', 'issued');`,
    espera: { error: '42501' },
  },
  {
    nombre: 'Un profesional no puede reescribir una receta ya emitida',
    sql: `${preparar} ${como(PRO)} update clinical_medications set quantity = '99' where id = '${RX}';`,
    espera: { error: '42501' },
  },
  {
    nombre: 'El paciente no puede consultar las recetas de otro',
    sql: `${preparar} ${como(PACIENTE)} select count(*) from farmacia_recetas_de('${PRO}');`,
    espera: { error: '42501' },
  },
]

async function correr(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `begin; ${sql} rollback;` }),
  })
  const cuerpo = await r.json().catch(() => ({}))
  return Array.isArray(cuerpo) ? { filas: cuerpo } : { error: cuerpo.message ?? JSON.stringify(cuerpo) }
}

let fallas = 0
console.log(`Farmacia — la receta la exige la base (staging ${REF})\n`)
for (const caso of CASOS) {
  const res = await correr(caso.sql)
  let ok
  if (caso.espera.error) ok = !!res.error && res.error.includes(caso.espera.error)
  else ok = !res.error && res.filas?.at(-1)?.r === caso.espera.valor
  if (!ok) fallas++
  console.log(`${ok ? '✅' : '❌'} ${caso.nombre}`)
  if (!ok) console.log(`   esperaba ${JSON.stringify(caso.espera)} y vino ${JSON.stringify(res).slice(0, 300)}`)
}
console.log(fallas ? `\n❌ ${fallas} caso(s) en rojo.` : '\n✅ Nadie compra con receta sin tenerla.')
process.exit(fallas ? 1 : 0)
