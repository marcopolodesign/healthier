-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación del profesional por el super admin — motivo, revisión vs.
-- rechazo permanente, auditoría de quién revisa, y documentos gestionados
-- por el super admin.
--
-- Salió de una call con el CEO (2026-08-06). Palabras textuales:
--   "si no aprueba el perfil del profesional o necesita revisión, hay que
--    darle un porqué. esto tiene que salir en el dashboard del profesional."
--   "confirmar rechazo tiene que tener la posibilidad de avisarle al
--    profesional y que vuelva a cargar. O rechazo permanente."
--   "actualizar tabla cuando se rechaza"
--   "hay que dejar registro de QUE usuario esta verificando"
--   "que el super admin pueda subir/editar los documentos"
--
-- Qué faltaba: el rechazo era una sola acción binaria (is_verified=false +
-- rejection_reason), sin distinguir "puede corregir y reenviar" de "no puede
-- volver a intentar". No había ningún registro de qué admin tomó la decisión.
-- El super admin sólo podía LEER documentos, nunca subirlos ni reemplazarlos.
--
-- Qué NO cambia: `is_verified` sigue siendo el booleano que ya usan
-- `getDashboardPool`, `search`, `buscarCobrables` y las policies de
-- `professional_profiles` — no se toca su semántica ni se agrega una máquina
-- de estados nueva encima. Sólo se le suma UN dato — `rejection_type` — que
-- distingue las dos formas de "no verificado con motivo" que ya existían de
-- hecho (rejection_reason/rejected_at, desde la 003).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. "Necesita revisión" vs. rechazo permanente ──────────────────────────
-- NULL = sin rechazo (pendiente normal). 'revision' = puede corregir y
-- reenviar desde onboarding. 'permanente' = no puede reenviar (bloqueado más
-- abajo con un trigger, no sólo en la UI).
alter table public.professional_profiles
  add column if not exists rejection_type text
    check (rejection_type in ('revision', 'permanente'));

comment on column public.professional_profiles.rejection_type is
  'revision = el profesional puede corregir y reenviar el onboarding. permanente = no puede reenviar (bloqueado por trigger). NULL junto con rejected_at NULL = todavía no fue rechazado.';

-- `verified_by` (uuid, admin que verificó) y `verified_at` ya existían desde
-- la 045 (verificación SISA) pero el flujo de aprobación manual nunca los
-- completaba — quedaban NULL en toda aprobación manual. Se empieza a usar acá
-- (ver professionalService.approve() en el código), no hace falta columna
-- nueva.

-- ── 2. Bloquear que un rechazo permanente se pueda "reenviar" ──────────────
-- La UI ya no muestra el botón de reenvío para este caso (Dashboard.jsx), pero
-- la regla real tiene que vivir en la base: un professional_profiles con
-- rejection_type='permanente' no se puede modificar más que por admin/super_admin.
-- Esto corta de raíz cualquier camino de reenvío — onboarding, configuración,
-- o uno que se agregue después — sin tener que acordarse de gatear cada uno.
create or replace function public.bloquear_cambios_tras_rechazo_permanente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.get_my_role() not in ('admin', 'super_admin') then
    raise exception 'Este perfil profesional fue rechazado de forma permanente y no se puede modificar. Contactá a Healthier.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists professional_profiles_bloquear_rechazo_permanente on public.professional_profiles;
create trigger professional_profiles_bloquear_rechazo_permanente
  before update on public.professional_profiles
  for each row
  when (old.rejection_type = 'permanente')
  execute function public.bloquear_cambios_tras_rechazo_permanente();

-- ── 3. Auditoría — qué usuario revisó, cuándo, con qué motivo ──────────────
-- Tabla de historial, no columnas sueltas en professional_profiles: una
-- revisión puede pasar varias veces sobre el mismo profesional (pide revisión
-- → recarga → vuelve a pedir revisión → aprueba) y el CEO pidió explícitamente
-- poder ver ese historial, no sólo la última acción. Mismo patrón que
-- `clinical_access_log` (033/073) y `rcta_issue_log` (092): tabla de log
-- append-only, sólo la lee super_admin.
create table if not exists public.professional_verification_log (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  professional_profile_id  uuid not null references public.professional_profiles(id) on delete cascade,
  reviewed_by              uuid references public.profiles(id) on delete set null,
  action                   text not null check (action in ('approved', 'needs_revision', 'rejected_permanent')),
  reason                   text
);

comment on table public.professional_verification_log is
  'Un renglón por cada decisión de verificación que toma un super admin sobre un profesional (aprobar, pedir revisión, rechazar permanente). Existe para poder mostrar "quién revisó y cuándo" y el historial completo cuando una revisión pasa varias veces sobre el mismo profesional.';
comment on column public.professional_verification_log.reviewed_by is
  'auth.uid() del super admin que tomó la decisión — con qué usuario se hizo, no sólo cuándo.';

create index if not exists idx_pvl_professional  on public.professional_verification_log (professional_profile_id, created_at desc);
create index if not exists idx_pvl_created_at    on public.professional_verification_log (created_at desc);

alter table public.professional_verification_log enable row level security;

drop policy if exists "pvl_super_admin_select" on public.professional_verification_log;
create policy "pvl_super_admin_select" on public.professional_verification_log
  for select using (public.get_my_role() = 'super_admin');

-- El insert lo hace el propio browser del super admin (no una Edge Function
-- con service role), así que necesita policy — y `reviewed_by = auth.uid()`
-- evita que se pueda dejar constancia a nombre de otro admin.
drop policy if exists "pvl_super_admin_insert" on public.professional_verification_log;
create policy "pvl_super_admin_insert" on public.professional_verification_log
  for insert with check (public.get_my_role() = 'super_admin' and reviewed_by = auth.uid());

-- ── 4. Avisarle al profesional — mismo mecanismo que ya existe (091) ───────
-- "confirmar rechazo tiene que tener la posibilidad de avisarle al
-- profesional": ya existe `enviar_push` (091, push disparada desde la base,
-- vía Vault + pg_net) para "nueva consulta"/"te pagaron"/"paciente esperando".
-- Se reutiliza tal cual — no se abre un canal nuevo. El `when` del trigger es
-- a propósito angosto: `professional_profiles` recibe escrituras frecuentes
-- que no tienen nada que ver con esto (heartbeat de on-demand cada 30s,
-- cambios de tarifa, etc.) y no hay que despertar la función en cada una.
create or replace function public.avisar_revision_profesional()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.rejection_type is not null then
    perform public.enviar_push(
      new.user_id,
      case when new.rejection_type = 'permanente'
        then 'Tu perfil fue rechazado'
        else 'Tu perfil necesita revisión'
      end,
      coalesce(new.rejection_reason, 'Revisá el detalle en tu panel.'),
      '/profesional/dashboard'
    );
  elsif new.is_verified = true then
    perform public.enviar_push(
      new.user_id,
      '¡Tu perfil fue verificado!',
      'Ya podés recibir consultas en Healthier.',
      '/profesional/dashboard'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists professional_profiles_avisar_revision on public.professional_profiles;
create trigger professional_profiles_avisar_revision
  after update on public.professional_profiles
  for each row
  when (
    (new.rejection_type is not null and old.rejection_type is distinct from new.rejection_type)
    or (new.is_verified = true and old.is_verified is distinct from true)
  )
  execute function public.avisar_revision_profesional();

-- ── 5. El super admin puede subir y reemplazar documentos ──────────────────
-- Hasta ahora `professional-docs` sólo tenía policies de:
--   - SELECT: dueño, o admin/super_admin (prof_docs_owner_read)
--   - INSERT: sólo el dueño, sólo en su propia carpeta (prof_docs_owner_upload)
-- No había forma de que el super admin subiera un documento EN NOMBRE de un
-- profesional (carpeta = user_id del profesional, no del admin) ni de
-- reemplazar uno existente (no había policy de UPDATE para nadie en este
-- bucket). El browser del super admin ya reusa `professionalService.uploadDocument`
-- (mismo código que usa el profesional en onboarding) — sólo faltaba el permiso.
drop policy if exists "prof_docs_super_admin_insert" on storage.objects;
create policy "prof_docs_super_admin_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'professional-docs'
    and public.get_my_role() = 'super_admin'
  );

drop policy if exists "prof_docs_super_admin_update" on storage.objects;
create policy "prof_docs_super_admin_update"
  on storage.objects for update
  using (
    bucket_id = 'professional-docs'
    and public.get_my_role() = 'super_admin'
  )
  with check (
    bucket_id = 'professional-docs'
    and public.get_my_role() = 'super_admin'
  );
