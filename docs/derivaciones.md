# Derivaciones

Pedido de Mateo (2026-10-10): *"un profesional puede derivar a otro profesional con
nombre y apellido o directamente a otra vertical"*. Migración **195**.

## Decisiones (de Mateo)

1. **Dónde deriva el profesional:** al cerrar la consulta (panel clínico / detalle de la
   consulta) **y** en cualquier momento desde la ficha del paciente.
2. **A quién:** a un profesional concreto (buscado por nombre, sólo verificados y que se
   puedan reservar) **o** a una vertical, con especialidad opcional dentro de ella
   ("Clínica · Cardiología", o "Nutrición" a secas). **Motivo obligatorio.**
3. **Historia clínica:** el que recibe ve la nota de derivación siempre; la HC completa
   **sólo si el paciente da su consentimiento** (queda registrado en
   `derivacion_consentimientos`). Se puede cambiar después.
4. **Cobro:** la consulta del derivado se paga como cualquier otra, precio normal.
5. **El que recibe no tiene que aceptar:** se le avisa y el paciente reserva directo en su agenda
   (o, si es a una vertical, elige profesional de esa vertical como en la búsqueda).
6. **Pero sí puede rechazar** una derivación a su nombre (motivo opcional, mientras no haya
   turno): pasa a *rechazada*, se le avisa al paciente (push + mail) y el paciente ve "El Dr. X
   no puede tomarla" con la opción de reservar con otro profesional de la misma especialidad.
8. **Por nombre sólo se deriva a profesionales que se pueden reservar** (verificados, con
   Mercado Pago conectado y precio cargado — `buscar_profesionales_cobrables`). Decidido por
   Mateo el 2026-10-10: derivar a alguien a quien el paciente no puede pagarle no sirve.
7. **Vence a los 30 días.** Avisos de una derivación a especialidad: sólo al paciente; el
   profesional se entera cuando le reservan.

## Otras reglas

- Vencimiento: cron diario `vencer-derivaciones` (pendientes y rechazadas sin turno).
- **Avisos:** al paciente push + mail; al profesional destino (si es uno concreto) push + mail.
  Si es a una vertical, el profesional se entera al reservarse el turno con el aviso de
  siempre, y el turno muestra "Derivado por".
- Si el turno derivado se cancela, la derivación vuelve a *pendiente* (o a *rechazada* si
  venía de un rechazo), salvo que haya vencido.
- Un turno creado y **sin pagar** no bloquea: el paciente puede reintentar o reservar otro.
- Cancelar: sólo el que derivó (o el super admin), mientras no tenga turno.

## Modelo

`public.derivaciones`

| columna | |
|---|---|
| `id` | uuid |
| `patient_id` | paciente (FK profiles, RESTRICT) |
| `derivado_por` | profesional que deriva (FK profiles, RESTRICT) |
| `consulta_origen_id` | consulta desde la que se derivó (opcional) |
| `profesional_destino_id` | destino profesional (FK profiles, RESTRICT) — **o** |
| `vertical_destino` | destino vertical (`clinica`, `pediatria`, `nutricion`, `mente`, `fisico`, `veterinaria`, `preparador`) |
| `especialidad_destino` | slug de `specialties` dentro de esa vertical (opcional) |
| `motivo` | texto, obligatorio |
| `estado` | `pendiente` · `reservada` · `rechazada` · `vencida` · `cancelada` |
| `consentimiento_hc` | `null` = no respondió · `true` · `false` |
| `consentimiento_at` / `consentimiento_por` | |
| `consulta_reservada_id` / `reservada_at` | la consulta que se reservó desde la derivación |
| `rechazada_at` / `motivo_rechazo` | si el destino la rechazó |
| `vence_at` | default now() + 30 días |
| `cancelada_at` / `cancelada_por` | |
| `created_at` | |

`consultations.derivacion_id` — la consulta reservada desde una derivación.

### Quién ve qué

- Paciente (y su titular, grupo familiar): las suyas.
- El que derivó: las que hizo.
- El destinatario: las que le hicieron (y, si fue a una vertical, la que terminó en un turno suyo).
- Super admin: todas.
- Las partes de una derivación vigente se ven el perfil (nombre/foto) entre sí.

### Historia clínica — `profesional_ve_hc(paciente)`

Todas las policies de lectura compartida de la HC (`clinical_*`, `clinical_notes`,
`diagnostic_reports`, `medical_documents`, `activity_plans`, archivos de `patient-docs`)
pasan por esta función:

- una consulta normal con el paciente da acceso, como siempre;
- una consulta **reservada desde una derivación** da acceso sólo con consentimiento;
- el destinatario de una derivación vigente con consentimiento ve la HC aunque todavía no
  haya turno.

### RPC (todas las escrituras van por acá)

```js
// Profesional deriva. Destino: p_profesional_destino_id XOR p_vertical_destino.
supabase.rpc('crear_derivacion', {
  p_patient_id, p_motivo,
  p_profesional_destino_id: null | uuid,
  p_vertical_destino: null | 'clinica' | ...,
  p_especialidad_destino: null | 'cardiologia' | ...,
  p_consulta_origen_id: null | uuid,
}) // → uuid

supabase.rpc('responder_consentimiento_derivacion', { p_derivacion_id, p_acepta: true|false })
supabase.rpc('cancelar_derivacion', { p_derivacion_id })
supabase.rpc('rechazar_derivacion', { p_derivacion_id, p_motivo: null | texto })  // sólo el destino
```

Los errores vienen en castellano en `error.message` — mostrarlos tal cual.

### Lectura

```js
supabase.from('derivaciones').select(`*,
  derivado:profiles!derivado_por(id, full_name, avatar_url),
  destino:profiles!profesional_destino_id(id, full_name, avatar_url),
  paciente:profiles!patient_id(id, full_name, avatar_url)`)
```

La especialidad del profesional (para mostrar "Dr. X · Cardiología") sale de
`professional_profiles.specialty` (slug) → `specialties.label`.

### Reserva vinculada

Al crear la consulta se manda `derivacion_id`. Un trigger valida que la derivación sea de ese
paciente, esté pendiente y no vencida, y que el profesional sea el destino (o de esa
vertical/especialidad); si no, la consulta no se crea y el error dice por qué. Al guardarse,
la derivación pasa a `reservada`.

### Avisos

- Push `derivacion-nueva` al paciente → `/paciente/derivaciones/<id>`.
- Push `pro-derivacion-recibida` al profesional destino → `/profesional/derivaciones/<id>`.
- Mail `derivacion` (`send-email`) al paciente y, si hay destino concreto, al profesional.
- Rechazo: push `derivacion-rechazada` + mail `derivacion-rechazada` al paciente.

### Pantallas

| Quién | Web | App |
|---|---|---|
| Profesional deriva | Botón "Derivar" en la ficha (`/profesional/paciente/:id`) y en el detalle de la consulta (`/profesional/consulta/:id`, junto a cerrar) | Botón "Derivar" en la ficha nativa del paciente; el panel clínico es el WebView del website |
| Paciente | Tarjeta en el inicio + `/paciente/derivaciones/:id` (motivo, consentimiento, reservar) | Tarjeta en el inicio + pantalla `derivacion/[id]` |
| Profesional que recibe | `/profesional/derivaciones/:id`, "Derivado por" en el turno y en la ficha | Pantalla `(pro)/derivacion/[id]`, "Derivado por" en el turno y la ficha |
| HC | Las derivaciones aparecen en la historia clínica (paciente y profesional) | — |
| Super admin | `/super-admin/derivaciones` | — |

## Controles

- `node scripts/verificar-derivaciones.mjs` (staging): RLS de quién ve qué, que sin
  consentimiento el destinatario no ve la HC (antes y después de reservar), que con
  consentimiento sí, y que la reserva queda vinculada (y que una consulta con otro
  profesional no se puede colgar de la derivación), el rechazo (sólo el destino; después se
  reserva con otro de la misma especialidad y no con él) y el vencimiento a 30 días.
