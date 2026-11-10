# Programa de referidos — plan por fases

> Pedido de Hyppo (CRM de Healthier) para la campaña de referidos, con el OK de Mateo
> (2026-11-04). Se parte del **Cuadro del Sistema de Referidos** de Healthier (PDF, 2 páginas).
> Este doc es interno: relevamiento, modelo, fases y las preguntas que tiene que decidir
> Healthier. **Fase 1 está aplicada sólo en staging** (migración 231). Nada de esto está en
> producción.

---

## 0. El cuadro, en una tabla

| Origen → destino | Referente gana | Referido gana | Hito |
|---|---|---|---|
| Profesional → Profesional | $50.000 (o $100.000 "acelerado") | Garantía de ingresos mínimos ($300.000 en 60 días) | El referido completa 100 consultas en 60 días (acelerado: en 14) |
| Profesional → Paciente (agenda propia) | 0% de comisión de Healthier con ese paciente | Cada 5 consultas, 1 gratis con un profesional de **otra vertical** | 5 consultas dentro de 30 días desde que entra |
| Profesional → Paciente (derivación interna) | "Bono por derivación" (sin monto) | Descuento en la 1ª consulta con la nueva especialidad (ej. 15%) | El paciente hace la consulta derivada |
| Paciente → Paciente | 1 consulta gratis en créditos cada 5 consultas acumuladas de sus referidos | Código 15% en la 1ª consulta | El referido hace y paga su 1ª consulta |
| Paciente → Profesional | 10 consultas gratis en créditos | Garantía de ingresos mínimos | El profesional se valida y completa 100 consultas en 60 días |
| Influencer → Paciente/Prof. | 5% en efectivo sobre cada consulta generada | 15% de descuento con el código | Ingresa el código y concreta la consulta |

Además: garantía escalable ($600.000 / 200 consultas, $900.000 / 300) y multiplicadores
horarios del on demand (+5–10% noche de semana, +15% fin de semana) que **salen de la
comisión de Healthier**.

---

## 1. Relevamiento — qué existe hoy

**Códigos y atribución**
- Sólo el **profesional** tiene código: `professional_profiles.referral_code` (115), 8
  caracteres sin `i l o 0 1`, inmutable. Link público `/r/<codigo>` → `ReferralLanding.jsx`,
  `resolver_link_de_referido()` registra la visita en `professional_referral_visits`.
- La atribución es **una columna**: `profiles.referred_by_professional_id` (write-once por
  trigger). La escribe **el cliente** al registrarse (`authService.register` /
  `completeGoogleProfile`, sólo si el rol es paciente). La app (`mobile/`) no tiene alta
  por link: sólo muestra el link y los contadores del profesional (`ReferralService.ts`,
  `mis_referidos()`).
- ⚠️ **Hueco existente:** como la columna sólo se congela cuando *ya* tiene valor, un
  paciente que entró sin link puede escribírsela **después**, desde su propia sesión, con
  cualquier profesional. Hoy el efecto es que esa consulta va al 0% de comisión. Con
  recompensas en plata es inaceptable → la fase 2 mueve el canje a una RPC del servidor.
- Profesional → profesional, paciente → paciente, paciente → profesional e influencer:
  **no existen**.

**Comisión**
- `comision_efectiva(pro, paciente, at)` (184/185) es la única fuente: 0% si el paciente
  (o su titular del grupo familiar) vino por el link de ese profesional → tasa propia del
  profesional vigente → general (`platform_settings.commission_rate`, 20%). La llama
  `mp-payment` en cada cobro y queda guardada en `payments.commission_rate_applied` +
  `commission_source` (`general | profesional | referido`).

**Créditos (Healthy Credits)**
- `patient_credits`: ledger en **pesos**, `reason in (refund, redeem, mp_refund_conversion,
  adjustment)`, saldo = `get_credit_balance()`. No vencen.
- `mp-payment` los consume primero (`useCredits`); si cubren todo, no hay llamada a MP
  (`method='credits'`). La parte pagada con créditos la **liquida Healthier a mano** al
  profesional: `payments.manual_settlement_amount = créditos × (1 − tasa)`, y el super
  admin la ve en *Pagos → liquidaciones pendientes* y la marca liquidada.
- La pre-autorización del on demand **no admite créditos** (sólo tarjeta).
- `mp-refund` devuelve a créditos el `gross_amount` entero.

**Descuentos / cupones:** no existe nada. Ni tabla, ni campo en `payments`.

**Derivaciones** (195, 203): tabla `derivaciones` (a un profesional o a una
vertical/especialidad, vence a 30 días, `consulta_reservada_id`, `consultations.derivacion_id`).
"La consulta del derivado se paga como cualquier otra" — sin descuento ni bono.

**Cómo cobra `mp-payment`** (lo que hay que respetar)
- El monto sale de `consultations.price_at_booking`, nunca del cliente.
- Split: el cobro va a la cuenta MP **del profesional** (su OAuth) y Healthier se lleva
  `application_fee = bruto × tasa` (nunca más que lo cobrado; MP rechaza
  `application_fee = 0`, se omite). El fee de MP lo paga el profesional.
- Tres caminos: agendada (captura inmediata), on demand (pre-autorización
  `capture:false` + `mp-capture`), 100% créditos (sin MP).

**Super admin:** `/super-admin/referidos` (embudo por profesional: visitas, registros, con
consulta), `/super-admin/usuarios-referidos` (una fila por paciente referido), columna de
tasa aplicada + origen en *Pagos*, comisión por profesional en *Profesionales*,
*Derivaciones*.

**`cio`:** `cio.people` trae `referral_code` del profesional (sólo profesionales). La 230
(rama en paralelo) le suma `tiene_app`, `referido_por_profesional_id` y
`referido_por_profesional_nombre`. `cio.events` es una unión de eventos
(`appointment_booked`, `consultation_completed`, `payment_approved`, …). Nada de créditos
ni de recompensas.

---

## 2. Fase 1 — hecha en staging (migración 231)

Lo único que **no tiene decisiones abiertas** y que todas las recompensas necesitan.

- **`referral_codes`** — un código por persona (paciente o profesional **titular**; los
  familiares no). El del profesional es **el mismo** de su link `/r/` (backfill + trigger
  que lo alinea si el legajo se crea después). Los pacientes reciben uno nuevo. Mismo
  alfabeto; el generador ahora mira los dos espacios para que no choquen. Inmutable. RLS:
  cada uno lee el suyo, admin todos, nadie escribe desde el cliente.
- **`referral_attributions`** — una fila por referido (write-once): referente, rol de cada
  lado, `tipo` (`profesional_profesional | profesional_paciente | paciente_paciente |
  paciente_profesional`), código, `origen` (`link_profesional` hoy; `codigo` y `admin`
  reservados). Se llena por trigger cuando se fija `referred_by_professional_id` y se
  backfilleó. Los familiares no son un referido aparte (cuentan por el titular, igual que
  en la 185). `comision_efectiva` **no cambió**.
- **`cio.referidos`** (una fila por atribución + `referido_consultas_completadas`,
  `referido_primera_consulta_pagada_at`, `referido_atenciones_completadas`) y
  **`cio.people_referidos`** (una fila por persona, mismo universo que `cio.people`:
  `codigo_referido`, `referido_por_id`, `referido_tipo`, `referido_at`, `referidos_total`,
  `referidos_pacientes`, `referidos_profesionales`, `referidos_con_consulta`,
  `consultas_de_referidos`). Vistas **nuevas** a propósito: no se redefine `cio.people` para
  no chocar con la 230. En Customer.io se cargan como un segundo modelo de *people* con el
  mismo `id`; cuando la 230 esté en los dos ambientes, se fusionan al final de `cio.people`.
- **Control:** `node scripts/verificar-referidos.mjs` (staging) — 19 chequeos: códigos para
  todos, alineado con `/r/`, alta nueva, atribución desde el link, `comision_efectiva`
  intacta, inmutabilidad, RLS, y las dos vistas leídas como `cio_reader`.

Staging quedó con 47 códigos (todos los titulares) y 1 atribución (backfill).

---

## 3. Modelo de datos objetivo

```
referral_codes          (231) user_id → code
influencers             (F6)  id, nombre, email, code (mismo espacio de códigos), cbu/alias,
                              pct_comision, pct_descuento, activo
referral_attributions   (231) referred_id → referrer_id | influencer_id, tipo, origen
referral_settings       (F3)  montos y % del cuadro, editables por el super admin
                              (bono 50k/100k, garantía 300k/100/60d + escalones, 15%, 5%,
                              5 consultas, ventana 30d, 10 consultas, multiplicadores)
patient_benefits        (F3)  lo que el PACIENTE tiene para usar:
                              id, patient_id, tipo (primera_consulta_pct | consulta_gratis_otra_vertical),
                              pct | monto_max, vertical_excluida, origen_attribution_id | derivacion_id,
                              estado disponible → usado | vencido, vence_at, usado_en_payment_id
referral_rewards        (F4)  ledger de lo que se le DEBE a un referente:
                              id, beneficiario_id | influencer_id, attribution_id, regla,
                              tramo (para "cada 5": 1, 2, 3…), unidad (ars | creditos),
                              monto_ars, estado pendiente → ganada → pagada | anulada,
                              ganada_at, pagada_at, pagada_via (credito | liquidacion_manual | mp | transferencia),
                              payment_id / consultation_id de origen, nota, created_by
                              UNIQUE (regla, beneficiario, attribution_id, tramo)  ← idempotencia
professional_guarantees (F5)  pro_id, monto_garantizado, consultas_objetivo, desde, hasta,
                              estado en_curso → cumplida | no_cumplida → liquidada,
                              ingreso_real_ars, diferencia_ars
payments  (+columnas, F3)     discount_amount, discount_source (codigo_paciente | derivacion |
                              influencer | consulta_gratis), discount_benefit_id
```

Reglas del ledger: **pendiente** = la atribución existe y la ventana corre; **ganada** = se
cumplió el hito (la escribe el trigger o el cron, nunca el cliente); **pagada** = se acreditó
(créditos: insert en `patient_credits` con `reason='referral'`, hay que sumarlo al check) o
se liquidó (plata: lo marca el super admin, como hoy las liquidaciones manuales);
**anulada** = devolución, contracargo o fraude. Todo SECURITY DEFINER, sin policies de
escritura, append-only en lo posible (mismo patrón que `professional_commission_changes`).

---

## 4. Cómo se aplica cada descuento en el cobro sin romper Mercado Pago

Una función nueva del servidor, `beneficio_aplicable(consultation_id)`, que `mp-payment`
llama justo después de `comision_efectiva`, igual que hoy: devuelve `{pct | monto,
origen, benefit_id}` o nada. **El cliente nunca manda el descuento**; a lo sumo manda el
código (y eso se canjea en una RPC antes, que crea el `patient_benefit`).

Con el descuento **absorbido por Healthier** (recomendado, ver preguntas), las cuentas son:

```
bruto           = price_at_booking
descuento       = bruto × pct
cobrado         = bruto − descuento − créditos
neto_pro        = bruto × (1 − tasa)          ← el profesional cobra igual que sin descuento
application_fee = max(0, cobrado − neto_pro)  (si da 0 → se omite, MP no acepta 0)
faltante        = max(0, neto_pro − cobrado)  → manual_settlement_amount
```

(Con créditos solos la fórmula de hoy es `fee = min(bruto × tasa, cobrado)` y
`manual = créditos × (1 − tasa)`, que deja al profesional `créditos × tasa` por debajo de su
neto cuando el pago es mixto. La fórmula de arriba lo unifica; revisarlo con Mateo al
implementar porque cambia un número que hoy ya se liquida.)

O sea: mientras el descuento entre en la comisión de Healthier (15% ≤ 20%), sale del
`application_fee` y el profesional no se entera. Cuando no entra —consulta gratis, 15% con
un profesional al 0% (referido de agenda propia), multiplicador + descuento—, el faltante
va a **`manual_settlement_amount`**, que es exactamente el mecanismo que ya usan los
créditos y que el super admin ya liquida. **No hace falta nada nuevo del lado de MP.**

- **Consulta 100% gratis** → mismo camino que `credits_full_cover`: sin MP, `method` nuevo
  `'benefit'` (o `'credits'` con `discount_source='consulta_gratis'`), neto al profesional
  por liquidación manual.
- **On demand (pre-autorización):** se autoriza el monto ya descontado; `mp-capture`
  captura ese mismo monto. Ojo con el **despacho** de staging (`ondemand-despacho`, el
  pago se crea antes de saber el médico): el descuento se calcula por paciente, así que
  sirve igual, pero el faltante se liquida al que acepta.
- **Montos mínimos:** MP rechaza montos muy chicos; si `cobrado` queda por debajo del
  mínimo, se trata como gratis (decidir el umbral al implementar, probarlo en sandbox).
- **Devoluciones:** hoy `mp-refund` acredita `gross_amount`. Con descuentos tiene que
  acreditar `cobrado + créditos` (lo que el paciente puso), y el beneficio usado vuelve a
  `disponible` si la consulta no se hizo. **Cambiar esto antes de prender cualquier
  descuento.**
- **Multiplicadores horarios:** no tocan lo que paga el paciente; son una tasa menor de
  Healthier → nuevo origen `'multiplicador'` en `comision_efectiva` (y en el CHECK de
  `commission_source`). Se suma al resto de la cadena, no la reemplaza.
- `comision_efectiva` y `beneficio_aplicable` se guardan en el pago (tasa, origen,
  descuento, beneficio) → la historia no se reescribe si cambian los montos.

Control nuevo obligatorio: extender `verificar-pagos.mjs` / `verificar-comision.mjs` con un
cobro con descuento parcial, uno gratis y una devolución de un cobro con descuento.

---

## 5. Qué se calcula por evento y qué por cron

| Regla | Disparo | Cómo |
|---|---|---|
| Paciente → paciente: 15% en la 1ª consulta | canje del código | RPC `canjear_codigo(codigo)` crea atribución + `patient_benefit` |
| Paciente → paciente: 1 crédito cada 5 consultas de referidos | trigger al pasar una consulta a `completed` (+ pagada) | cuenta las consultas de todos sus referidos, `tramo = floor(n/5)`, inserta reward `ganada` idempotente; se paga como crédito al instante (o al cierre del día) |
| Prof. → paciente: 5 consultas en 30 días → 1 gratis otra vertical | trigger al completar | si el referido llegó a 5 dentro de `atribuido_at + 30d` → `patient_benefit` `consulta_gratis_otra_vertical` |
| Derivación: 15% en la 1ª con la especialidad | al reservar desde la derivación | `patient_benefit` atado a `derivacion_id`; el bono del que deriva → reward al completarse |
| Prof. → prof. / Paciente → prof.: 100 consultas en 60 días | **cron diario** | ventana desde la **verificación** del referido; a los 14 días evalúa el acelerado, a los 60 el normal; marca `ganada` o `anulada` |
| Garantía de ingresos | **cron diario** | `professional_guarantees` en curso; al cerrar la ventana, si ≥ objetivo y `ingreso_real < garantizado` → diferencia a liquidar |
| Influencer 5% | trigger al completar + pagar | reward `ganada` por consulta; se liquida por mes |
| Vencimientos (beneficios, ventanas) | cron diario | `disponible → vencido`, `pendiente → anulada` |

Hay `pg_cron` en staging (jobs `vencer-derivaciones`, `avisos-de-consulta`, …): se agrega
uno `referidos-diario` con el mismo patrón. **Qué es una "consulta" para los hitos:**
`consultations.status = 'completed'` **y** pagada (`payment_status='paid'` o exenta),
excluyendo cuentas de prueba — ver preguntas.

---

## 6. Qué ve el super admin

Regla de Mateo: todo lo operativo se ve en `/super-admin/*` en el mismo cambio.

- **Referidos** (ampliar la página existente) con pestañas: *Atribuciones* (todas, por tipo,
  con origen y fecha), *Recompensas* (pendientes / ganadas / pagadas, con botón "marcar
  pagada" y medio, como las liquidaciones), *Beneficios de pacientes* (disponibles, usados,
  vencidos), *Garantías en curso* (progreso X/100 y días restantes), *Influencers* (F6).
- **Pagos:** columna de descuento + origen al lado de la tasa aplicada; las liquidaciones
  pendientes suman los faltantes de descuentos y las recompensas en plata.
- **Configuración:** los montos del cuadro (`referral_settings`), con historial.
- **Usuarios / Profesionales:** el código de cada uno y quién lo refirió en el drawer.
- Fase 1 no agregó pantalla: el dato nuevo (códigos de pacientes) todavía no se puede usar
  desde ningún lado. Entra con la fase 2, que es cuando se vuelve operativo.

---

## 7. `cio` — qué se suma (siempre al final, sin romper lo existente)

- **Ya en staging (231):** `cio.referidos`, `cio.people_referidos`.
- **Al fusionar con `cio.people`** (después de la 230 en los dos ambientes): al final de
  la vista, `codigo_referido`, `link_referido` (para pacientes, cuando exista el link),
  `referido_por_id`, `referido_tipo`, `referido_at`, `referidos_total`,
  `referidos_con_consulta`, `consultas_de_referidos`. **No duplicar**
  `referido_por_profesional_id` de la 230: queda como está (es la vista "vieja" del mismo
  dato) y `referido_por_id` + `referido_tipo` cubren todos los tipos.
- **F3/F4:** `creditos_saldo_ars`, `beneficio_disponible` (tipo + vence_at),
  `recompensas_ganadas_ars`, `recompensas_pendientes`, `proximo_tramo_en` (cuántas
  consultas de referidos faltan para el próximo crédito — el gancho de mails de Hyppo),
  `garantia_consultas_en_ventana`, `garantia_vence_at`.
- **`cio.events`** (al final de la unión): `referral_signup`, `referral_milestone`
  (primera consulta pagada / 5 consultas / 100 consultas), `reward_earned`, `reward_paid`,
  `benefit_granted`, `benefit_expiring` (7 días antes). Montos sí; nada clínico (la
  especialidad de destino de una derivación **no** va: dice algo de la salud del paciente).
- Nueva vista `cio.referral_rewards` para Metabase (una fila por recompensa).

---

## 8. Web y app

| Pieza | website | mobile |
|---|---|---|
| Canje del código al registrarse (campo + `/r/<codigo>` para todos) | ✅ | ✅ (alta nativa; hoy no toma referidos) |
| "Invitá y ganá": mi código, link, compartir, progreso | ✅ paciente y profesional | ✅ paciente y profesional |
| Ver mis beneficios / créditos y aplicarlos en el pago | ✅ | ✅ (la app ya muestra créditos en el pago) |
| Garantía: progreso X/100 | ✅ profesional | ✅ Inicio del profesional |
| Super admin, influencers, configuración | ✅ | ❌ nunca |
| Cobro (`mp-payment`, `mp-capture`, `mp-refund`), triggers, cron, `cio` | servidor, compartido | — |

Paridad web/app es obligatoria para todo lo de paciente.

---

## 9. Fases

1. **✅ Base (231, staging):** códigos para todos, atribución con tipo, vistas `cio`.
2. **Canje y compartir:** `canjear_codigo()` del servidor (cierra el hueco de la columna
   escrita por el cliente), `/r/<codigo>` resuelve también códigos de paciente, alta con
   código en web y app, pantalla "invitá" para todos, super admin de atribuciones.
   Sin plata todavía → se puede lanzar la campaña de captación mientras se decide el resto.
3. **Descuentos en el cobro:** `referral_settings`, `patient_benefits`,
   `beneficio_aplicable()`, cambios en `mp-payment` / `mp-capture` / `mp-refund`, 15% del
   paciente referido y de la derivación. Pruebas de pagos completas en staging.
4. **Recompensas:** `referral_rewards`, trigger de "cada 5", crédito automático, consulta
   gratis de otra vertical, super admin de recompensas. Eventos a `cio`.
5. **Profesionales:** garantía (base y escalones), bono pro→pro y paciente→pro (cron),
   multiplicadores horarios en `comision_efectiva`.
6. **Influencers:** alta, código, 5% y liquidación mensual.

Cada fase: local → staging (migración + Edge Functions + rama `staging`) → revisión
(`pre-prod-review.py`, `/code-review`, `/security-review`) → OK de Mateo → producción.

---

## 10. Preguntas de negocio (las decide Healthier)

Con la recomendación de cómo lo haríamos si no hay otra preferencia.

1. **¿Quién absorbe el 15% (código de paciente, derivación, influencer)?** → Healthier,
   de su comisión. El profesional cobra igual que sin descuento; si no entra en la
   comisión, Healthier le liquida la diferencia como hoy con los créditos.
2. **"1 consulta gratis en créditos": ¿de qué monto?** → un monto fijo en pesos
   configurable (ej. el precio promedio de una consulta de Clínica), no "una consulta
   cualquiera": los créditos son pesos y una consulta de $15.000 y una de $60.000 no
   pueden valer lo mismo. Alternativa: un vale de "1 consulta hasta $X".
3. **"Cada 5 consultas, una gratis con otra vertical" (agenda propia): ¿hasta qué monto,
   y quién la paga?** → la paga Healthier (el otro profesional cobra completo por
   liquidación), con tope en pesos, vence a 60 días.
4. **¿Qué cuenta como "consulta" para los hitos?** → completada **y** pagada (no las
   gratis ni las 100% créditos de beneficios), sin cancelar ni no-show, sin cuentas de
   prueba. ¿Cuentan las del grupo familiar del referido? → sí, por el titular.
5. **¿Desde cuándo corren los 60 días del profesional?** → desde que lo **verifican**, no
   desde el alta (si no, el tiempo de revisión del legajo le come la ventana).
6. **Bono $50.000 / $100.000: ¿se suman o es uno u otro?** → uno u otro (100k si llega en
   14 días, si no 50k a los 60). ¿Cómo se paga? → transferencia o liquidación manual
   marcada por el super admin; no hay forma de que Healthier le pague por MP desde la
   plataforma hoy. ¿Necesita factura del profesional?
7. **"10 consultas gratis en créditos" (paciente que trae un profesional):** mismo tema
   que la 2 — ¿10 × qué monto? ¿Se acreditan todas juntas al hito o de a una?
8. **Garantía de ingresos:** ¿"tarifa base acumulada" es el neto del profesional (después
   de la comisión y del fee de MP) o el bruto? → neto después de comisión, antes de fee de
   MP (el fee depende de cómo configuró su cuenta). ¿Y si hace 100 consultas en el día 61?
   → no aplica. ¿Quién elige el escalón 600k/900k y cuándo? → el profesional al entrar,
   con default 300k. ¿La garantía es **sólo** para referidos o para todos los nuevos?
9. **Multiplicadores horarios:** ¿noche = qué horario? ¿+5 o +10% (o según qué)? ¿"fin de
   semana" incluye feriados? El cuadro dice +15% y que a Healthier le queda 5%: ¿la
   comisión baja a 5% (o sea, el bono es +15% *del valor*, que es el 75% de la comisión), o
   el profesional cobra 115%? → interpretamos que el paciente paga lo mismo y la comisión
   de Healthier baja de 20% a 5–15%. ¿Aplica sólo al on demand?
10. **¿Se acumulan los beneficios?** (código 15% + créditos + derivación 15% + influencer)
    → un solo **descuento** por consulta (el mayor); los créditos sí se suman encima porque
    son saldo del paciente.
11. **¿Qué pasa con una devolución?** → se le devuelve al paciente lo que puso; el
    beneficio usado vuelve a disponible si la consulta no se hizo; si una recompensa ya se
    ganó con esa consulta, se anula (y si ya se pagó en créditos, se descuenta del saldo
    sin dejarlo negativo).
12. **Influencer: ¿es un tipo de usuario nuevo?** → no; es una ficha que carga el super
    admin (nombre, código, CBU/alias, %), sin login, con un reporte mensual. ¿El 5% es
    sobre el bruto o sobre lo cobrado? → sobre lo cobrado. ¿Hay tope de tiempo (ej.
    sólo las consultas de los primeros 90 días del referido)? → sí, 90 días. ¿Factura?
13. **¿El código del 15% es el mismo código de referido del paciente que invita?** → sí:
    un solo código por persona, que al canjearlo da el 15% y deja la atribución.
14. **Ventana de canje:** ¿hasta cuándo puede alguien cargar un código? → sólo al
    registrarse o antes de su primera consulta, nunca después.
15. **Profesional → profesional: ¿el referido tiene que ser de otra especialidad? ¿Hay
    tope de referidos por persona?** → sin tope al principio, revisar con datos.
16. **Derivación: "bono para el profesional que deriva", ¿cuánto?** El cuadro dice
    "equivalente al esquema de derivación cruzada", que no existe. → proponer un % de la
    consulta derivada, liquidado manual.
17. **Prof. → paciente (agenda propia): ¿los 30 días son para hacer las 5 consultas, y
    se repite (cada 5 → otra gratis) o es una sola vez?** → una sola vez por paciente.
18. **¿Hay presupuesto o tope total del programa** (monto mensual máximo de recompensas)?
    → conviene un tope configurable con alerta al super admin.

---

## 11. Notas técnicas para quien siga

- `comision_efectiva` sigue leyendo `profiles.referred_by_professional_id`. Cuando el canje
  pase a la RPC del servidor (F2), la RPC escribe las dos cosas; no migrar la comisión a la
  tabla nueva hasta que el backfill y el canje estén probados.
- Los familiares no tienen código ni atribución propia: todo cuenta por el titular.
- En staging casi todas las cuentas son `es_prueba` → las vistas `cio` salen casi vacías;
  el control apaga la marca un instante para probarlas.
- La 231 se aplicó en staging antes que la 230: el hueco en `schema_migrations` se cierra
  cuando la otra rama aplique la suya.
- **Límites de `canjear_codigo` (fase 2) a resolver ANTES de la fase de recompensas:**
  1. El control de círculos mira **un solo nivel** (no se puede canjear el código de quien
     te trajo a vos), no cadenas más largas (A→B→C→A). Con plata hay que decidir si se
     recorre la cadena entera.
  2. `p_via` (`link` / `codigo`) lo manda el **cliente** y sólo decide el `origen` guardado:
     no es una prueba de cómo llegó el referido. Si una recompensa depende del origen, hay
     que derivarlo en el servidor.
- **Bienvenida con "te invitó":** `send-email` espera hasta ~3 s la atribución (pg_net corta a los 5 s) cuando el alta
  trae `referral_code` en la metadata del usuario (el canje corre en otro request, después del
  INSERT del perfil); sin código no espera. El nombre sale de `referral_attributions`.
