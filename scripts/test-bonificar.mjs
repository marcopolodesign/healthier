#!/usr/bin/env node
/**
 * Control del bug de "Bonificar" (2026-10-13): con la cuenta de Mateo
 * (`payment_exempt` en prod) el interruptor apagado seguía mostrando "Consulta
 * bonificada" y el servidor la bonificaba igual. Falla si vuelve:
 *  - la regla del front (src/lib/bonificar.js) y la del servidor
 *    (supabase/functions/_shared/bonificar.ts) tienen que decidir lo mismo
 *    para todo caso, con el payload que arma `camposBonificar`;
 *  - con el interruptor apagado, la cuenta exenta se COBRA;
 *  - un cliente viejo (sin `cobrar`) se comporta igual que antes;
 *  - otra cuenta no puede bonificarse ni dejar de estar exenta por el payload;
 *  - las pantallas usan la regla (no `paymentExempt || bonificar`).
 * Uso: node scripts/test-bonificar.mjs   (desde website/)
 */
import { readFileSync } from 'node:fs'
import { bonificarPorDefecto, teleclinicaBonificada, camposBonificar, sosBonificada, SOS_BONIFICAR_POR_DEFECTO } from '../src/lib/bonificar.js'
import { exentoEnServidor, puedeBonificar, emergenciaBonificadaEnServidor } from '../supabase/functions/_shared/bonificar.ts'

let fallas = 0
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fallas++ }

const MATEO = 'mateoaldao@gmail.com'
const OTRA = 'paciente@healthier.app'

for (const email of [MATEO, OTRA]) {
  for (const paymentExempt of [true, false]) {
    for (const bonificar of [true, false]) {
      const habil = puedeBonificar(email)
      const pantalla = teleclinicaBonificada({ paymentExempt, puedeBonificar: habil, bonificar })
      const servidor = exentoEnServidor({ paymentExempt, email, ...camposBonificar({ puedeBonificar: habil, bonificar }) })
      ok(pantalla === servidor, `${email} exento=${paymentExempt} interruptor=${bonificar}: pantalla ${pantalla ? 'bonificada' : 'cobra'} = servidor ${servidor ? 'bonificada' : 'cobra'}`)
    }
  }
}

// El bug, literal.
ok(teleclinicaBonificada({ paymentExempt: true, puedeBonificar: true, bonificar: false }) === false,
  'Mateo exento con el interruptor apagado: la pantalla NO dice bonificada')
ok(exentoEnServidor({ paymentExempt: true, email: MATEO, ...camposBonificar({ puedeBonificar: true, bonificar: false }) }) === false,
  'Mateo exento con el interruptor apagado: el servidor cobra')
ok(bonificarPorDefecto(true) === true && bonificarPorDefecto(false) === false && bonificarPorDefecto(undefined) === false,
  'el interruptor arranca prendido sólo si la cuenta ya es exenta')

// Cliente viejo (OTA anterior): manda sólo `bonificar`.
ok(exentoEnServidor({ paymentExempt: true, email: MATEO, bonificar: false }) === true, 'cliente viejo, Mateo exento: sigue bonificada')
ok(exentoEnServidor({ paymentExempt: false, email: MATEO, bonificar: true }) === true, 'cliente viejo, Mateo con interruptor: bonificada')
ok(exentoEnServidor({ paymentExempt: false, email: MATEO, bonificar: false }) === false, 'cliente viejo, Mateo sin interruptor: cobra')

// Otra cuenta: el payload no cambia nada.
ok(exentoEnServidor({ paymentExempt: false, email: OTRA, bonificar: true }) === false, 'otra cuenta no se bonifica mandando bonificar:true')
ok(exentoEnServidor({ paymentExempt: true, email: OTRA, bonificar: false, cobrar: true }) === true, 'otra cuenta exenta no pierde la exención mandando cobrar:true')
ok(JSON.stringify(camposBonificar({ puedeBonificar: false, bonificar: true })) === '{"bonificar":false}', 'otra cuenta no manda bonificar ni cobrar')

// Guardas estáticas: las pantallas y la función usan la regla.
const onDemand = readFileSync(new URL('../src/pages/patient/OnDemand.jsx', import.meta.url), 'utf8')
ok(/teleclinicaBonificada\(/.test(onDemand) && /camposBonificar\(/.test(onDemand), 'OnDemand.jsx usa teleclinicaBonificada y camposBonificar')
ok(!/paymentExempt\)\s*\|\|\s*\(puedeBonificar/.test(onDemand), 'OnDemand.jsx no vuelve a `paymentExempt || (puedeBonificar && bonificar)`')
const servicio = readFileSync(new URL('../src/services/ondemandService.js', import.meta.url), 'utf8')
ok(/cobrar/.test(servicio.match(/pedir\([^)]*\)\s*{[^}]*}/s)?.[0] ?? ''), 'ondemandService.pedir manda `cobrar`')
const despacho = readFileSync(new URL('../supabase/functions/ondemand-despacho/index.ts', import.meta.url), 'utf8')
ok(/exentoEnServidor\(/.test(despacho) && /cobrar:\s*body\.cobrar/.test(despacho), 'ondemand-despacho decide con exentoEnServidor y lee body.cobrar')
ok(!/payment_exempt\)\s*\|\|/.test(despacho), 'ondemand-despacho no tiene otra regla de exento a mano')

// ── S.O.S. (2026-10-22) ─────────────────────────────────────────────────
// Sólo la cuenta del interruptor; el perfil exento NO bonifica el S.O.S.
for (const email of [MATEO, OTRA]) {
  for (const bonificar of [true, false]) {
    const habil = puedeBonificar(email)
    const pantalla = sosBonificada({ puedeBonificar: habil, bonificar })
    const servidor = emergenciaBonificadaEnServidor({ email, ...camposBonificar({ puedeBonificar: habil, bonificar }) })
    ok(pantalla === servidor, `S.O.S. ${email} interruptor=${bonificar}: pantalla ${pantalla ? 'bonificada' : 'cobra'} = servidor ${servidor ? 'bonificada' : 'cobra'}`)
  }
}
ok(SOS_BONIFICAR_POR_DEFECTO === true, 'S.O.S.: el interruptor arranca prendido')
ok(emergenciaBonificadaEnServidor({ email: OTRA, bonificar: true }) === false, 'S.O.S.: otra cuenta no se bonifica mandando bonificar:true')
ok(emergenciaBonificadaEnServidor({ email: MATEO, bonificar: true, cobrar: true }) === false, 'S.O.S.: con cobrar:true se cobra')
ok(emergenciaBonificadaEnServidor({ email: null, bonificar: true }) === false, 'S.O.S.: sin mail (service key) no se bonifica')

const mpPayment = readFileSync(new URL('../supabase/functions/mp-payment/index.ts', import.meta.url), 'utf8')
ok(/emergenciaBonificadaEnServidor\(\{\s*email: user\.email/.test(mpPayment), 'mp-payment decide el S.O.S. bonificado con el mail de la sesión')
const emergencyJsx = readFileSync(new URL('../src/pages/patient/Emergency.jsx', import.meta.url), 'utf8')
ok(/sosBonificada\(/.test(emergencyJsx) && /camposBonificar\(/.test(emergencyJsx), 'Emergency.jsx usa sosBonificada y camposBonificar')

// Cierre sin pago: "No authorized payment for this emergency" dejaba la
// emergencia sin poder cerrarse. No vuelve.
const mpCapture = readFileSync(new URL('../supabase/functions/mp-capture/index.ts', import.meta.url), 'utf8')
ok(!/No authorized payment for this emergency/.test(mpCapture), 'mp-capture ya no corta el cierre con "No authorized payment"')
ok(/sinPago: true/.test(mpCapture) && /action === "cerrar-sin-pago"/.test(mpCapture), 'mp-capture contesta sinPago y tiene cerrar-sin-pago')
const cola = readFileSync(new URL('../src/pages/dispatch/Cola.jsx', import.meta.url), 'utf8')
ok(/cobro\?\.sinPago/.test(cola) && /cerrarEmergenciaSinPago\(/.test(cola), 'el despacho muestra el cartel y registra el cierre sin pago')

console.log(fallas ? `\n${fallas} falla(s)` : '\nTodo verde')
process.exit(fallas ? 1 : 0)
