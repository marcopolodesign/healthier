-- ============================================================
-- 222 — Certificados desde la consulta: constancia de atención y reposo
-- ============================================================
-- Pedido de los profesionales (2026-11-02): "constancias de atención médica o
-- certificados de reposo laboral". Mateo: que salgan por la receta
-- electrónica que ya usamos. Se emiten con el endpoint "Otras
-- Prescripciones" del servicio de recetas (POST /apirecipe/OtrasPrescripciones)
-- desde la Edge Function `rcta-certificado`, que reusa el armado del médico,
-- del paciente, la firma y el log de `rcta-issue` (_shared/rcta.ts).
--
-- Qué hay acá:
--   · `clinical_certificates`: un renglón por certificado. Lo escribe SÓLO la
--     Edge Function (service role): el cliente no puede ni insertar ni cambiar
--     el estado, igual que con las recetas emitidas (migración 216).
--   · Lectura: el paciente los suyos, el profesional los que emitió, el
--     super admin todos.
--   · `rcta_issue_log.certificado_id`: el log de cada llamada al servicio de
--     recetas, también para los certificados.
--   · Mail + push (campanita) al paciente cuando queda emitido, una sola vez,
--     disparado desde la base (patrón de las migraciones 146/167).
-- ============================================================

create table if not exists public.clinical_certificates (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  patient_id         uuid not null references public.profiles(id) on delete restrict,
  professional_id    uuid not null references public.profiles(id) on delete restrict,
  consultation_id    uuid not null references public.consultations(id) on delete restrict,
  encounter_id       uuid references public.clinical_encounters(id) on delete set null,

  -- Los dos modelos. Si mañana hace falta otro (apto físico, escolar), se suma
  -- al check y a `_shared/rcta-certificado.ts`.
  tipo               text not null check (tipo in ('constancia', 'reposo')),
  -- Constancia: cuándo fue la atención (inicio de la consulta, o el turno).
  atencion_at        timestamptz,
  -- Reposo: cuántos días y desde cuándo (día argentino).
  dias               integer check (dias between 1 and 30),
  desde              date,
  indicaciones       text check (char_length(indicaciones) <= 1000),

  -- Diagnóstico opcional. Si `imprimir_diagnostico` es false NO viaja al
  -- servicio de recetas: probado contra homologación (2026-11-02), con un
  -- CIE-10 y imprimirDiagnostico = 'N' el código igual sale impreso.
  cie10_code         text,
  cie10_display      text,
  imprimir_diagnostico boolean not null default false,

  status             text not null default 'pending'
                     check (status in ('pending', 'issued', 'error', 'anulado')),
  error_detalle      text,

  -- Lo que devuelve el servicio de recetas (`otrasRecetas[0]`).
  rcta_hash          text,   -- `id`: con esto se anula
  rcta_numero        text,   -- `numeroPrescripcion`, el que va impreso
  rcta_verificador   text,
  rcta_pdf_url       text,
  rcta_issued_at     timestamptz,

  anulado_at         timestamptz,
  anulacion_estado   text check (anulacion_estado in ('confirmada', 'no_hacia_falta', 'error')),
  anulacion_detalle  text,

  mail_enviado_at    timestamptz,

  constraint clinical_certificates_reposo_completo
    check (tipo <> 'reposo' or (dias is not null and desde is not null))
);

comment on table public.clinical_certificates is
  'Certificados emitidos desde la consulta (constancia de atención / reposo) por el servicio de recetas, endpoint Otras Prescripciones. Los escribe sólo la Edge Function rcta-certificado.';
comment on column public.clinical_certificates.rcta_hash is
  'Campo `id` de la respuesta de la emisión: es el identificador con el que se anula (DELETE /apirecipe/OtrasPrescripciones/{id}). No es el número impreso.';
comment on column public.clinical_certificates.imprimir_diagnostico is
  'false = el diagnóstico queda sólo en Healthier y no se manda al servicio de recetas (con N igual se imprimía el código CIE-10).';

create index if not exists clinical_certificates_patient_idx
  on public.clinical_certificates (patient_id, created_at desc);
create index if not exists clinical_certificates_consultation_idx
  on public.clinical_certificates (consultation_id);

alter table public.clinical_certificates enable row level security;

-- Sin policies de insert/update/delete: escribe sólo la Edge Function.
drop policy if exists clinical_certificates_paciente_lee on public.clinical_certificates;
create policy clinical_certificates_paciente_lee on public.clinical_certificates
  for select using (patient_id = auth.uid());

drop policy if exists clinical_certificates_profesional_lee on public.clinical_certificates;
create policy clinical_certificates_profesional_lee on public.clinical_certificates
  for select using (professional_id = auth.uid());

drop policy if exists clinical_certificates_super_admin_lee on public.clinical_certificates;
create policy clinical_certificates_super_admin_lee on public.clinical_certificates
  for select using (public.get_my_role() = 'super_admin');

create or replace function public.clinical_certificates_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists clinical_certificates_touch on public.clinical_certificates;
create trigger clinical_certificates_touch
  before update on public.clinical_certificates
  for each row execute function public.clinical_certificates_touch();

-- ── El log de las llamadas al servicio de recetas ───────────────────────────
alter table public.rcta_issue_log
  add column if not exists certificado_id uuid references public.clinical_certificates(id) on delete set null;

create index if not exists rcta_issue_log_certificado_idx
  on public.rcta_issue_log (certificado_id) where certificado_id is not null;

-- ── Aviso al paciente: mail + push, una sola vez ────────────────────────────
-- Los dos en el mismo trigger, y la marca después: así no hay orden alfabético
-- de triggers del que depender (lo que pasó con la receta, migración 167).
create or replace function public.avisar_certificado_al_paciente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status is distinct from 'issued'
     or old.status is not distinct from new.status
     or new.mail_enviado_at is not null then
    return new;
  end if;

  perform public.enviar_mail(jsonb_build_object(
    'tipo', 'certificado', 'certificadoId', new.id
  ));
  perform public.enviar_push_tipo(
    new.patient_id, 'certificado-emitido',
    jsonb_build_object('certificadoId', new.id, 'tipo', new.tipo)
  );

  update public.clinical_certificates
     set mail_enviado_at = now()
   where id = new.id;

  return new;
end;
$$;

drop trigger if exists clinical_certificates_avisar on public.clinical_certificates;
create trigger clinical_certificates_avisar
  after update of status on public.clinical_certificates
  for each row execute function public.avisar_certificado_al_paciente();
