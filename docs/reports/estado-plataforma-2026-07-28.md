# Estado real de la plataforma — 28 de julio de 2026

Escrito después de la primera prueba de videollamada real de punta a punta. El
criterio de este documento es separar **lo verificado** de **lo que todavía no**,
porque durante esta semana varias cosas parecían funcionar y no funcionaban.

Todos los números salen de consultas a la base de producción el 2026-07-28.

---

## Resumen en una línea

El flujo del paciente está completo y verificado pieza por pieza. **Lo que
todavía no pasó ni una vez es una videollamada exitosa de punta a punta con dos
personas reales** — el intento del 28/07 falló por un bug que ya está corregido,
pero la corrección se validó por simulación, no repitiendo la prueba.

---

## La prueba del 28/07: qué pasó realmente

Mateo y una profesional intentaron una videollamada. Síntomas reportados:

- Cada uno veía su propia cámara, ninguno veía la del otro.
- El profesional no veía cambiar el estado en "Consultas de hoy".
- Hubo que refrescar la página del paciente a mano.
- Terminó registrada como `no_show`.

**Causa raíz, probada con evidencia:** la función que asigna la sala de video
hacía *leer → si está vacío, crear → guardar*, sin ninguna guarda de
concurrencia. Cuando los dos lados piden la sala casi al mismo tiempo, ambos leen
que no hay ninguna, **ambos crean una**, y el segundo pisa al primero en la base.
Cada cliente ya se quedó con la URL que recibió, así que **terminaron en salas
distintas**.

La API de Daily lo confirma: **dos salas creadas en el mismo segundo** (12:20:09)
para esa consulta, y solo una guardada.

El `no_show` fue **consecuencia**: el cliente del paciente marca `no_show` al
colgar si el profesional nunca se unió — y desde su punto de vista nunca se unió.

**Estado:** corregido con una toma atómica (gana quien llega primero; el que
pierde borra su sala huérfana y usa la del ganador). Verificado disparando la
carrera exacta: ambos lados reciben la misma URL. **No re-probado con dos
personas reales.**

---

## Números de la plataforma

| | |
|---|---|
| Consultas totales | 129 |
| — completadas | 46 |
| — confirmadas | 49 |
| — canceladas | 26 |
| — trabadas en `in_progress` | **4** ⚠️ |
| Profesionales | 13 (11 verificados) |
| **Profesionales con Mercado Pago conectado** | **1** ⚠️ |
| Profesionales on-demand que pueden cobrar | **1** ⚠️ |
| Pagos registrados | 4 (1 capturado, $4.000) |
| Migraciones aplicadas | 71 |

---

## El cuello de botella real: hay un solo profesional operativo

De 13 profesionales, **uno solo tiene Mercado Pago conectado**. Como el booking
está bloqueado para quien no puede cobrar, en la práctica **toda la plataforma
depende de la Dra. Valentina Ortega**.

Consecuencias concretas:

- El pool de on-demand para Clínica es de **uno**. La rotación y el failover que
  se construyeron no tienen con qué ejercitarse.
- Pediatría **no muestra precio** en el dashboard del paciente, porque ningún
  pediatra on-demand puede cobrar. No es un bug: es el dato real.
- Cualquier prueba de concurrencia (dos pacientes a la vez) no es posible.

**Esto es coordinación, no código.** Es el bloqueo más grande hoy.

---

## Qué está verificado y qué no

### Verificado en browser contra producción

- Registro, login y navegación del paciente.
- Pre-consulta estructurada: catálogo de 14 síntomas codificados en ICD-10,
  preguntas de calificación por síntoma, medicación. Se guarda y **el profesional
  la ve** con el código y los signos de alarma resaltados, tanto en la
  videollamada como en el detalle de la consulta.
- Sala de espera: el paciente marca presencia, el profesional la ve en vivo
  ("En sala · hace X min"), y el badge se apaga solo al vencer el TTL de 90s.
- Habilitación explícita: el profesional toca "Ingresar paciente" y el paciente
  **se desbloquea sin refresh**.
- Tarjetas guardadas reales (el mock `**** 4242` ya no existe en ningún lado).
- Checkout on-demand con el Brick de Mercado Pago en modo producción.

### NO verificado

- **Una videollamada completa con dos personas reales.** Es lo más importante
  pendiente.
- **El primer pago real de punta a punta** con captura y liberación (el split
  78/22 nunca se ejercitó con dinero real de un médico con cuenta propia).
- **Safari**: hay un arreglo desplegado para el Brick de Mercado Pago basado en
  comportamiento documentado de Safari (no monta iframes que nacen con
  `display:none`), pero **el bug nunca se reprodujo** en WebKit headless, así que
  la corrección está sin confirmar contra el síntoma real.
- **Mobile**: en pausa por decisión de Mateo. Acumula deuda de paridad.

---

## Bugs de fondo encontrados esta semana

Vale enumerarlos porque comparten un patrón: **parecían funcionar**.

1. **Realtime estaba muerto.** La única tabla publicada era `walk_in_queue`, así
   que las cuatro suscripciones sobre `consultations` que hay en el código nunca
   dispararon un evento. Parecían andar porque el estado inicial se lee al
   montar; lo que no funcionaba era la actualización en vivo — justo lo que estas
   pantallas necesitan.
2. **Dos salas de Daily por carrera** (arriba).
3. **`push_subscriptions` estaba en cero.** El banner de opt-in se gateaba por
   `Notification.permission`, y `subscribe()` pide el permiso *antes* de crear la
   suscripción: cuando la VAPID key faltaba en producción, quedaba permiso
   concedido y tabla vacía, y el banner no volvía a aparecer nunca. Trampa de una
   sola dirección. Corregido — ya hay 2 suscripciones.
4. **La pre-consulta de mobile se guardaba donde nadie la lee** (`notes` en vez
   de `preconsulta_data`).
5. **El claim de `walk_in_queue` no tiene guarda de concurrencia** — dos
   profesionales pueden tomar la misma entrada. Sigue sin corregir; es candidato
   a ser la causa del error por el que Fastpass está deshabilitado desde el 23/07.

---

## Deuda técnica que conviene atacar

- **Sin TypeScript, el build no caza imports faltantes.** Pasó **tres veces** el
  28/07 (`formatDistance`, `VERTICAL_SPECIALTIES`, `consultationEventsService`):
  `npm run build` pasa limpio y la página revienta en runtime. Un `eslint` con
  `no-undef` atajaría toda esta clase de bug antes del deploy. Es la mejora de
  mayor relación valor/esfuerzo pendiente.
- **4 consultas trabadas en `in_progress`**, la más vieja del 11/06. Nadie las
  cierra. Son la razón por la que el banner de "continuar turno" necesita un tope
  de 6 h en vez de confiar en el estado.
- **`profiles` tiene un email duplicado** (`paciente@healthier.app` con dos
  filas). Ensucia cualquier query que resuelva paciente por email.
- **El cierre de consulta sigue ofreciendo "adjuntar receta"** como archivo,
  ahora que la receta real se genera desde la videollamada.

---

## Lo que hay que hacer antes de mostrarle esto a alguien

En orden:

1. **Que más médicos conecten Mercado Pago.** Sin eso no hay producto que probar.
2. **Repetir la videollamada con dos personas reales.** Ahora hay bitácora: si
   falla, se despliega la fila en "Consultas recientes" del super admin y se ve
   exactamente qué pasó.
3. **El primer pago real** con un médico con cuenta propia y una consulta de
   precio bajo.
4. **Confirmar el arreglo de Safari** en un iPhone de verdad.
