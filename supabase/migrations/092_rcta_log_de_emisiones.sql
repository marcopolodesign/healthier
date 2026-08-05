-- ============================================================
-- Migration 092 — Log de emisiones RCTA + id de transacción de Innovamed
-- ============================================================
-- Innovamed certifica la integración pidiendo "las 4 pruebas copiando el id de
-- transacción de cada una" (soporte.it@innovamed.com.ar, 2026-07-28). Ese dato
-- viene en `idTransaccion`, al tope de la respuesta de POST /apirecipe/Receta, y
-- hasta hoy **no se guardaba en ningún lado**: `rcta-issue` leía `recetas[0]` y
-- tiraba el resto. Cuando pidieron los ids, la única fuente era un .md escrito a
-- mano el día de las pruebas.
--
-- La regla que se desprende: **de una integración externa se guarda el
-- intercambio, no el resumen**. El resumen siempre deja afuera justo el campo
-- que el otro lado te va a pedir seis meses después.
--
-- Dos piezas:
--   1. `rcta_issue_log` — una fila por intento (exitoso o no) con request,
--      response, http status, y los identificadores de los dos lados.
--   2. `clinical_medications.rcta_transaction_id` / `rcta_verificador` — para
--      no tener que ir al log cuando lo que se quiere es "esta receta nuestra,
--      ¿cuál es del lado de ellos?".
-- ============================================================

-- ── 1. El log ───────────────────────────────────────────────────────────────
create table if not exists public.rcta_issue_log (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),

  -- Nuestro lado. `medication_ids` es un array porque una receta lleva N
  -- medicamentos y todos comparten la misma llamada.
  medication_ids    uuid[] not null default '{}',
  encounter_id      uuid references public.clinical_encounters(id) on delete set null,
  consultation_id   uuid references public.consultations(id)       on delete set null,
  patient_id        uuid references public.profiles(id)            on delete set null,
  professional_id   uuid references public.profiles(id)            on delete set null,

  -- Para qué se emitió. Las pruebas de certificación conviven con las recetas
  -- reales y hay que poder separarlas sin adivinar por la fecha.
  purpose           text not null default 'produccion'
                    check (purpose in ('produccion', 'certificacion')),

  -- Contra qué ambiente. Homologación y producción tienen idReceta con la misma
  -- forma: sin esto, dentro de un año nadie sabe cuál es cuál.
  api_base_url      text,
  cliente_app_id    integer,
  endpoint          text not null default '/apirecipe/Receta',

  -- El intercambio, crudo.
  request           jsonb,
  http_status       integer,
  response          jsonb,
  duration_ms       integer,

  -- El lado de Innovamed, desnormalizado para poder buscarlo.
  id_transaccion    text,
  id_receta         text,
  verificador       text,
  nro_cuir          text[],
  s3_link           text,
  errores           jsonb,

  outcome           text not null
                    check (outcome in ('issued', 'validation_error', 'api_error', 'network_error', 'persist_error')),
  error_code        text
);

comment on table public.rcta_issue_log is
  'Un renglón por llamada a POST /apirecipe/Receta (Innovamed QBI2), exitosa o no. Existe para dos cosas: certificar ante Innovamed (piden el idTransaccion de cada prueba) y poder reconstruir qué se mandó cuando una receta sale mal. Contiene datos del paciente (nombre, DNI, cobertura, medicación) dentro de `request` — por eso sólo lo lee super_admin.';
comment on column public.rcta_issue_log.id_transaccion is
  'Campo `idTransaccion` de la respuesta. Es EL dato que Innovamed pide para certificar; no confundir con idReceta.';
comment on column public.rcta_issue_log.request is
  'Payload exacto enviado. Incluye datos personales y de salud del paciente: nunca exponer fuera de super_admin.';
comment on column public.rcta_issue_log.purpose is
  'certificacion = prueba pedida por Innovamed; produccion = receta de un acto médico real.';

create index if not exists rcta_issue_log_created_at_idx    on public.rcta_issue_log (created_at desc);
create index if not exists rcta_issue_log_transaccion_idx   on public.rcta_issue_log (id_transaccion);
create index if not exists rcta_issue_log_receta_idx        on public.rcta_issue_log (id_receta);
create index if not exists rcta_issue_log_medication_ids_ix on public.rcta_issue_log using gin (medication_ids);

alter table public.rcta_issue_log enable row level security;

-- Sólo lectura, y sólo super_admin. Escribe la Edge Function con service role,
-- que no pasa por RLS: no hace falta (ni conviene) una policy de insert.
drop policy if exists "rcta_issue_log_super_admin_read" on public.rcta_issue_log;
create policy "rcta_issue_log_super_admin_read" on public.rcta_issue_log
  for select using (public.get_my_role() = 'super_admin');

-- ── 2. El match receta nuestra ↔ receta de ellos ────────────────────────────
alter table public.clinical_medications
  add column if not exists rcta_transaction_id text,
  add column if not exists rcta_verificador    text;

comment on column public.clinical_medications.rcta_transaction_id is
  'idTransaccion de Innovamed para la llamada que emitió esta receta. Junto con rcta_prescription_id (idReceta) es lo que permite hablar de la misma receta con ellos.';
comment on column public.clinical_medications.rcta_verificador is
  'Código verificador que Innovamed imprime en el PDF. Es con lo que la farmacia valida la receta.';

create index if not exists clinical_medications_rcta_transaction_idx
  on public.clinical_medications (rcta_transaction_id)
  where rcta_transaction_id is not null;
