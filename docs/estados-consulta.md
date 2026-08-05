# Estados de una consulta — auditoría y reglas

> **Estado:** auditoría del 2026-08-05 + reglas **confirmadas por Mateo** el mismo
> día. Implementación pendiente. Esta página es la referencia: los crons y las
> guardas se escriben contra lo que dice acá.

Hoy no hay una máquina de estados: hay estados, y escrituras sueltas de estados.

---

## 1. Lo que hay hoy

### Estados válidos (constraint `consultations_status_check`, migración 048)

```
pending · confirmed · in_progress · pending_pro_close · completed · cancelled · no_show
```

`payment_status` (constraint, migración 056):

```
pending_payment · in_process · paid · rejected · refunded
```

### Los cuatro problemas reales

**1. El cron que cierra turnos vencidos nunca se agendó.**
`supabase/functions/expire-stale-appointments` existe y está bien escrita (marca
`no_show` los `confirmed` con `scheduled_at` de más de 2 h), pero la migración 048
deja el `cron.schedule()` **en un comentario**, explícitamente sin aplicar. No hay
ninguna migración en el repo que registre un job. Confirmado contra la base: 0
filas con `refund_pending`, y los 2 `no_show` que existen los generó un paciente
desde la UI (en `consultation_events` no hay un solo `no_show` con
`actor_role='system'`).

**Consecuencia medida:** **62 consultas** están `pending` o `confirmed` con la fecha
vencida hace más de 2 h; **51** hace más de 7 días. En la app siguen mostrando
botón de "Entrar" porque la UI trata `confirmed` como "próxima" sin mirar la fecha.

**2. Ningún cambio de estado está protegido.**
Casi todo pasa por `consultationsService.updateStatus(id, status)`, que es un
`update({status}).eq('id', id)` a secas: no mira el estado actual. No hay
transiciones ilegales porque no hay transiciones — hay escrituras. Además la RLS de
`consultations` es una sola policy `FOR ALL` para paciente/profesional/admin: un
paciente puede escribir `status='completed'` por PostgREST y nadie lo frena.

Excepciones (sí tienen guarda server-side): `finalize_consultation` (exige que las
dos partes hayan cerrado), `accept_ondemand_request` (claim atómico),
`daily-token`, y los patches de MP.

**3. Hay estados sin salida y uno inalcanzable.**
- `pending_pro_close` está en el constraint y la UI lo sabe pintar, pero **nada lo
  escribe**. Hay 1 fila en ese estado, permanentemente trabada.
- `in_progress` abandonado: nada mira `in_progress` en ningún cron. Si los dos se
  van sin cerrar, queda así para siempre — y en on-demand eso **mantiene viva la
  retención de la tarjeta**, porque el barrido de `mp-capture` saltea `in_progress`
  a propósito.
- `pending` vencido: la función de expiración filtra sólo `confirmed`, así que un
  turno que el profesional nunca confirmó no lo toca nadie (9 filas).
- 15 consultas `confirmed` + `paid`: plata cobrada, consulta que nunca se va a
  completar, y no cuentan en las ganancias del profesional (que filtran
  `completed`).

**4. La plata y el estado están desacoplados en las transiciones manuales.**
- Cancelar como **profesional o admin** no toca la plata, ni con `payment_status='paid'`.
  Sólo la cancelación del paciente intenta pedir reembolso (y desde el browser: si
  se cierra la pestaña, la consulta queda cancelada y la plata no se pide).
- `no_show` (los 2 botones manuales) no captura, no devuelve, no libera retención.
- `refund_pending` lo escribe únicamente la función de expiración (que no corre) y
  **no lo lee nadie**: no hay pantalla de super-admin que lo muestre.
- La app mobile escribe `payment_status='paid'` con un `setTimeout` de 1,5 s y sin
  llamar a MP (`app/consultation/payment.tsx`) — plata falsa en la base.

### Qué corre de verdad por cron hoy

| Job | Estado |
|---|---|
| `appointment-reminders` (cada 15 min) | ✅ agendado y vivo (nunca disparó: 0 filas con recordatorio marcado) |
| `mp-capture` barrido (cada 5 min) | ✅ agendado y vivo |
| `mp-refresh-tokens` (lunes 06:00) | ✅ agendado y vivo |
| `expire-stale-appointments` | ❌ **nunca se agendó** |
| `expire_ondemand_requests()` | ❌ existe en la base, **no lo llama nadie** |

Ninguno de los jobs vivos está en una migración: se registraron a mano en prod, así
que **no son reproducibles desde el repo**.

---

## 2. Reglas confirmadas (Mateo, 2026-08-05)

### Principio

Un estado sólo cambia por una transición declarada, y toda transición que mueva
plata la mueve **del lado del servidor**. Si depende de que una pestaña siga
abierta, no es una regla: es una casualidad.

### Máquina de estados

```
pending ──(pago aprobado | confirma el profesional)──────> confirmed
pending ──(rechaza el profesional | cancela el paciente)─> cancelled
pending ──(2 h después de scheduled_at, cron)───────────> expired

confirmed ──(alguien entra a la sala | código en puerta)─> in_progress
confirmed ──(cancela cualquiera)────────────────────────> cancelled
confirmed ──(2 h después, nadie entró nunca, cron)──────> expired
confirmed ──(2 h después, uno esperó y el otro no, cron)> no_show

in_progress ──(cierran las dos partes | cierre forzado)─> completed
in_progress ──(2 h sin cerrar, cron)────────────────────> completed

completed · cancelled · expired · no_show  →  terminales
```

### A — `expired` es un estado nuevo, distinto de `no_show`

Se agrega `expired` al constraint. Tolerancia: **2 h** después de `scheduled_at`.

- **`expired`** = nadie usó el turno. Ni `patient_waiting_since`, ni
  `patient_admitted_at`, ni `started_at`, ni sala creada. No penaliza a nadie.
- **`no_show`** = hay evidencia de que **uno estuvo y el otro no vino** (alguno de
  esos campos no es nulo). Queda reservado para eso, que es lo que la palabra
  significa; hoy se usa para las dos cosas.

Aplica también a `pending` vencido (hoy la función ni lo mira).

### B — `in_progress` abandonada: se cierra como `completed` y se cobra

A las **2 h** sin cierre, el cron la pasa a `completed`. Si los dos entraron a la
sala, la consulta pasó: se le cobra al paciente y le cuenta al profesional en sus
ganancias.

Efecto sobre la plata: dispara la captura de la retención igual que un cierre
normal (y de paso desactiva la trampa actual de que un `in_progress` abandonado
mantenga la retención viva para siempre).

### C — La plata vuelve como crédito, **siempre con aprobación de super admin**

Una consulta pagada que termina en `expired`, `no_show` o `cancelled` **no emite
crédito sola**: crea un **pedido pendiente** (`payments.refund_request_status =
'pending'`), y un super admin lo aprueba. Recién ahí se emiten los Healthy Credits.

Esto extiende la regla de producto del 2026-07-24 ("los reembolsos nunca son
automáticos") a los casos que hoy no la respetaban: hasta ahora sólo la
cancelación del paciente creaba un pedido; el vencimiento y las cancelaciones del
profesional/admin no hacían nada con la plata.

**Implica construir la pantalla de revisión en super-admin** — hoy `refund_pending`
es un flag que nadie mira, y sin pantalla esta regla es una cola invisible.

### D — Las transiciones se blindan ahora, con escape para nosotros

Se implementan guardas server-side (`WHERE status = <esperado>`) y RLS por estado:
el paciente y el profesional sólo pueden hacer las transiciones que les
corresponden.

**Excepción explícita:** la `service_role` (nuestros crons y edge functions) y los
**super admins** pueden escribir cualquier estado. Es la vía de escape para
destrabar casos raros a mano sin tener que tocar la base por afuera.

---

## 3. Deuda relacionada (sin decisión pendiente)

1. **Los crons van en migraciones**, no registrados a mano en prod como hoy.
2. **`pending_pro_close`**: sacarlo del constraint (migrar su única fila) o darle un
   escritor real. Hoy es ruido que la UI sabe pintar y nada produce.
3. **`started_at` en videollamada** — hoy sólo lo escribe el flujo presencial, por
   eso 19 consultas completadas no tienen duración.
4. **Sacar el pago mock de mobile** (`app/consultation/payment.tsx`) antes de
   cualquier prueba real: escribe `paid` sin mover plata.
5. **`expire_ondemand_requests()`** existe y no la llama nadie.
6. **Limpieza de los 62 turnos vencidos** — es data de prueba, se va con la
   limpieza de la semana; no hay que backfillear nada.
