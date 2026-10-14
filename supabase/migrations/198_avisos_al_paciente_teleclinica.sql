-- 198 — Los avisos al paciente de la Teleclínica y del cierre de consulta.
--
-- Cuatro cosas, todas del mismo problema: al paciente no le llegaba el aviso
-- que importa, y le llegaba uno que no corresponde (Mateo, 2026-10-13, prueba
-- en prod con su iPhone, pedido 46c636a4).
--
-- 1 · El token del dispositivo se lo queda quien está logueado.
--     `expo_push_tokens.token` es UNIQUE y la RLS sólo deja tocar filas
--     propias. Si el teléfono estuvo logueado antes con otra cuenta (las demo,
--     por ejemplo), el token quedó a nombre de esa otra cuenta y el
--     `upsert ... on conflict (token)` de la app rebota con
--     "new row violates row-level security policy (USING expression)" — 403.
--     La app sólo hacía `console.warn`, así que nadie se enteraba. En los logs
--     de prod hay 403 de ese tipo desde el iPhone de Mateo (iOS 27) el 06, 08,
--     09 y 13/10, incluido 17:46 UTC, tres minutos antes de que le aceptaran el
--     pedido. `registrar_push_token` reasigna el token a quien lo registra: el
--     token es del aparato, y el aparato es de quien tiene la sesión abierta.
--
-- 2 · "Te encontramos un profesional" al aceptar, por el catálogo (y por lo
--     tanto también en la campanita). Antes iba por `enviar_push` con título
--     suelto, que no escribe la campanita. Además el trigger miraba
--     `update of status`, y en ese momento `consultation_id` todavía es NULL
--     (accept_ondemand_request lo escribe en un segundo UPDATE): ahora se
--     dispara cuando el pedido aceptado recibe su consulta.
--
-- 3 · En una consulta inmediata no van "Te agendaron un turno" ni "Turno
--     confirmado". Los dos salían al aceptar: la consulta la inserta el
--     profesional (auth.uid() = professional_id → "te agendaron") y
--     ondemand-despacho la pasa a `confirmed` (→ "turno confirmado").
--
-- 4 · "Tu profesional ya cargó tu receta / tus indicaciones", agrupado. Las
--     indicaciones (notas de tipo Indicación y notas de cierre) y la receta
--     emitida marcan una fila en `avisos_consulta_pendientes`; un cron por
--     minuto manda UN aviso por consulta cuando hubo 90 s de calma (o 5 min
--     desde el primer cambio). Si la consulta está cerrando, espera al cierre:
--     el `post-consulta` (152) ya cuenta el resumen y la receta, y al pasar a
--     `completed` se descarta lo pendiente para no avisar dos veces. Lo que
--     llega DESPUÉS del cierre vuelve a avisar.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1 · Registro del token
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.registrar_push_token(
  p_token       text,
  p_platform    text default null,
  p_device_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Necesitás iniciar sesión.' using errcode = 'insufficient_privilege';
  end if;
  if p_token is null or p_token !~ '^(Exponent|Expo)PushToken\[.+\]$' then
    raise exception 'Token de push inválido.' using errcode = 'invalid_parameter_value';
  end if;

  insert into expo_push_tokens (user_id, token, platform, device_name, updated_at)
  values (auth.uid(), p_token, p_platform, p_device_name, now())
  on conflict (token) do update
     set user_id     = excluded.user_id,
         platform    = excluded.platform,
         device_name = excluded.device_name,
         updated_at  = now();
end;
$$;

revoke all on function public.registrar_push_token(text, text, text) from public, anon;
grant execute on function public.registrar_push_token(text, text, text) to authenticated;

comment on function public.registrar_push_token(text, text, text) is
  'Migración 198. Guarda el Expo push token del dispositivo a nombre de quien tiene la sesión, aunque antes haya sido de otra cuenta (el upsert directo rebotaba por RLS en silencio).';

-- ═════════════════════════════════════════════════════════════════════════════
-- 2 · "Te encontramos un profesional"
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.avisar_pedido_aceptado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'accepted' or new.consultation_id is null
     or old.consultation_id is not distinct from new.consultation_id then
    return new;
  end if;
  -- A quien pidió (y paga), aunque la consulta sea para un familiar.
  perform public.enviar_push_tipo(
    new.patient_id, 'ondemand-aceptado',
    jsonb_build_object(
      'consultationId', new.consultation_id,
      'requestId',      new.id,
      'vertical',       new.vertical
    )
  );
  return new;
end;
$$;

drop trigger if exists ondemand_requests_aceptado on public.ondemand_requests;
create trigger ondemand_requests_aceptado
  after update of status, consultation_id on public.ondemand_requests
  for each row execute function public.avisar_pedido_aceptado();

-- ═════════════════════════════════════════════════════════════════════════════
-- 3 · Sin textos de turno en una consulta inmediata
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.avisar_turno_agendado()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.patient_id is null or new.professional_id is null then return new; end if;
  -- Consulta inmediata: el aviso es "Te encontramos un profesional" (pedido aceptado).
  if coalesce(new.is_on_demand, false) then return new; end if;
  -- Sólo si lo agendó el profesional; si reservó el paciente, ya lo sabe.
  if auth.uid() is distinct from new.professional_id then return new; end if;
  perform public.enviar_push_tipo(
    new.patient_id, 'turno-agendado', jsonb_build_object('consultationId', new.id));
  return new;
end; $$;

create or replace function public.avisar_estado_al_paciente()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.patient_id is null then return new; end if;
  if new.status = 'confirmed' then
    -- Consulta inmediata: "confirmada" no es un turno; ya se avisó al aceptar.
    if coalesce(new.is_on_demand, false) then return new; end if;
    perform public.enviar_push_tipo(
      new.patient_id, 'turno-confirmado', jsonb_build_object('consultationId', new.id));
  elsif new.status = 'in_progress' then
    perform public.enviar_push_tipo(
      new.patient_id, 'profesional-listo', jsonb_build_object('consultationId', new.id));
  end if;
  return new;
end; $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4 · Receta / indicaciones, un aviso agrupado por consulta
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.avisos_consulta_pendientes (
  consultation_id  uuid primary key references public.consultations(id) on delete cascade,
  patient_id       uuid not null references public.profiles(id) on delete cascade,
  receta           boolean not null default false,
  indicaciones     boolean not null default false,
  primer_cambio_at timestamptz not null default now(),
  ultimo_cambio_at timestamptz not null default now()
);

alter table public.avisos_consulta_pendientes enable row level security;
-- Sin policies: sólo la tocan los triggers y el cron (security definer).

comment on table public.avisos_consulta_pendientes is
  'Migración 198. Novedades de una consulta (receta / indicaciones) que esperan para salir en UN solo aviso al paciente. Las vacía enviar_avisos_de_consulta() (cron por minuto).';

create or replace function public.marcar_aviso_de_consulta(
  p_consultation_id uuid,
  p_receta          boolean,
  p_indicaciones    boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient uuid;
begin
  if p_consultation_id is null then return; end if;
  select patient_id into v_patient from consultations where id = p_consultation_id;
  if v_patient is null then return; end if;

  insert into avisos_consulta_pendientes (consultation_id, patient_id, receta, indicaciones)
  values (p_consultation_id, v_patient, p_receta, p_indicaciones)
  on conflict (consultation_id) do update
     set receta           = avisos_consulta_pendientes.receta or excluded.receta,
         indicaciones     = avisos_consulta_pendientes.indicaciones or excluded.indicaciones,
         ultimo_cambio_at = now();
end;
$$;

revoke all on function public.marcar_aviso_de_consulta(uuid, boolean, boolean) from public, anon, authenticated;

-- 4a · Nota de tipo Indicación (las entradas no se editan: corregir = insertar).
create or replace function public.marcar_indicacion_cargada()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_consulta uuid;
begin
  if new.entry_type <> 'indication' or coalesce(trim(new.content), '') = '' then return new; end if;
  select consultation_id into v_consulta from clinical_encounters where id = new.encounter_id;
  perform public.marcar_aviso_de_consulta(v_consulta, false, true);
  return new;
end; $$;

drop trigger if exists clinical_entries_avisar_indicacion on public.clinical_entries;
create trigger clinical_entries_avisar_indicacion
  after insert on public.clinical_entries
  for each row execute function public.marcar_indicacion_cargada();

-- 4b · Notas de cierre (son indicaciones para el paciente).
create or replace function public.marcar_notas_de_cierre()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(trim(new.closing_notes), '') = ''
     or new.closing_notes is not distinct from old.closing_notes then
    return new;
  end if;
  -- Las notas que llegan EN el cierre (completar_cierre_de_consulta escribe
  -- notas y `completed` en el mismo UPDATE) ya las cuenta el post-consulta.
  -- Sin esto, avisar_cierre_al_paciente borra lo pendiente ANTES (los
  -- triggers corren por orden alfabético) y este las vuelve a marcar: el
  -- paciente recibía "Tu resumen ya está listo" y 90 s después "Tu
  -- profesional ya cargó tus indicaciones" (release 2026-10-14).
  if new.status = 'completed' and old.status is distinct from 'completed' then
    return new;
  end if;
  perform public.marcar_aviso_de_consulta(new.id, false, true);
  return new;
end; $$;

drop trigger if exists consultations_avisar_notas_cierre on public.consultations;
create trigger consultations_avisar_notas_cierre
  after update of closing_notes on public.consultations
  for each row execute function public.marcar_notas_de_cierre();

-- 4c · Receta emitida. Si es de una consulta, entra al aviso agrupado en vez
-- de salir sola ("Tu receta ya está disponible", 152): una consulta con una
-- receta y dos indicaciones avisa una vez, no tres. Una receta sin consulta
-- sigue con su aviso de siempre.
create or replace function public.avisar_receta_al_paciente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ya       timestamptz;
  v_consulta uuid;
begin
  if new.rcta_status is distinct from 'issued'
     or old.rcta_status is not distinct from new.rcta_status
     or new.rcta_prescription_id is null then
    return new;
  end if;

  select consultation_id into v_consulta from clinical_encounters where id = new.encounter_id;
  if v_consulta is not null then
    perform public.marcar_aviso_de_consulta(v_consulta, true, false);
    return new;
  end if;

  select max(mail_receta_enviado_at) into v_ya
    from public.clinical_medications
   where rcta_prescription_id = new.rcta_prescription_id;
  if v_ya is not null then return new; end if;

  perform public.enviar_push_tipo(
    new.patient_id, 'receta-emitida',
    jsonb_build_object('prescriptionId', new.rcta_prescription_id)
  );
  return new;
end;
$$;

-- 4d · Al cerrar, el post-consulta ya cuenta lo cargado hasta ahí.
create or replace function public.avisar_cierre_al_paciente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.patient_id is null then return new; end if;
  delete from public.avisos_consulta_pendientes where consultation_id = new.id;
  perform public.enviar_push_tipo(
    new.patient_id, 'post-consulta',
    jsonb_build_object('consultationId', new.id)
  );
  return new;
end;
$$;

-- 4e · El que manda. Calma de 90 s o techo de 5 min; si está cerrando, espera
-- al cierre hasta 15 min (el cron de la 098 cierra a los 10).
create or replace function public.enviar_avisos_de_consulta()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_n     integer := 0;
begin
  for r in
    delete from avisos_consulta_pendientes a
     using consultations c
     where c.id = a.consultation_id
       and (a.ultimo_cambio_at < now() - interval '90 seconds'
            or a.primer_cambio_at < now() - interval '5 minutes')
       and (c.status <> 'closing' or a.primer_cambio_at < now() - interval '15 minutes')
    returning a.*
  loop
    perform public.enviar_push_tipo(
      r.patient_id, 'consulta-novedades',
      jsonb_build_object(
        'consultationId', r.consultation_id,
        'receta',         r.receta,
        'indicaciones',   r.indicaciones
      )
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.enviar_avisos_de_consulta() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('avisos-de-consulta')
   where exists (select 1 from cron.job where jobname = 'avisos-de-consulta');
  perform cron.schedule('avisos-de-consulta', '* * * * *', 'select public.enviar_avisos_de_consulta()');
end $$;
