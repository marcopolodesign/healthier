-- Código de cierre — DURANTE la videoconsulta, no sólo al terminarla.
--
-- El problema real (Mateo, 2026-08-06): el código de 4 dígitos que valida el
-- cierre YA existe desde la migración 011 (`consultation_validation_codes`,
-- un código por consulta) y el paciente YA lo ve en pantalla durante la
-- videollamada (pill "Tu código" en `patient/VideoCall.jsx`). Pero cargarlo
-- sólo era posible DESPUÉS de cortar la llamada, en `CloseConsultationModal`
-- desde el detalle de la consulta — un lugar y un momento distintos de donde
-- pasa la conversación real. Pedido explícito: que el código se pida, se
-- comparta y se verifique EN la videollamada, con el profesional y el
-- paciente todavía conectados.
--
-- Encaje con la máquina de estados (migraciones 089/098): el código sigue
-- siendo lo que habilita `closing → completed`. Lo único que cambia es CUÁNDO
-- se puede cargar: ahora puede verificarse en cualquier momento en que la
-- consulta esté `in_progress` (en la llamada, antes de colgar) o `closing`
-- (después de colgar, como hasta ahora). Verificarlo temprano no cierra nada
-- por sí solo — sólo deja una marca (`closing_code_verified_at`) que el cierre
-- efectivo, más adelante, puede usar sin volver a pedir el código.
--
-- Piezas:
--   1. Columnas: cuántos intentos lleva, cuándo se verificó, y el motivo
--      cuando se cierra SIN código (decisión de producto de Mateo — el caso
--      normal es que el paciente ya se fue de la llamada).
--   2. `verificar_codigo_de_cierre` — valida el código contra la base. Tope
--      de 5 intentos: con un código de 4 dígitos (10.000 combinaciones), 5
--      intentos dejan la probabilidad de acertar al azar en 0,05%, y sólo el
--      profesional DE ESA consulta puede intentarlo (chequeo de
--      `professional_id = auth.uid()`, no hay endpoint público). No usa
--      RAISE EXCEPTION para el caso "código incorrecto": si lo hiciera, el
--      UPDATE que suma el intento se revertiría junto con la excepción (todo
--      el cuerpo de una función corre en una única transacción implícita), y
--      el contador nunca avanzaría. Devuelve un jsonb con el resultado en vez
--      de tirar error — RAISE queda reservado para los casos que sí deben
--      abortar sin dejar rastro (consulta ajena, estado inválido).
--   3. `completar_cierre_de_consulta` — el cierre efectivo (`closing`/
--      `in_progress` → `completed`). Exige UNA de dos cosas: código ya
--      verificado, o un motivo no vacío para cerrar sin él. Separada de
--      `finalize_consultation` (migración 011/022) a propósito: esa función
--      sigue intacta para el camino presencial y el handshake del paciente,
--      que no se tocan acá.
--
-- SQL idempotente — puede correrse más de una vez sin romper nada.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columnas
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.consultations
  add column if not exists closing_code_attempts int not null default 0,
  add column if not exists closing_code_verified_at timestamptz,
  add column if not exists closing_skipped_code_reason text;

comment on column public.consultations.closing_code_attempts is
  'Intentos fallidos de código de cierre para esta consulta. Tope: 5 (ver verificar_codigo_de_cierre). Nunca se resetea — es de un solo uso, la consulta no se repite.';
comment on column public.consultations.closing_code_verified_at is
  'Cuándo el profesional verificó correctamente el código de cierre del paciente. Puede pasar en cualquier momento con status in_progress o closing — no cierra la consulta por sí solo, sólo habilita completar_cierre_de_consulta sin volver a pedirlo.';
comment on column public.consultations.closing_skipped_code_reason is
  'Motivo que dejó el profesional al cerrar SIN código (p.ej. "el paciente ya había cortado"). NULL si el cierre tuvo código verificado. Visible en /super-admin/consultas — es la contracara auditable de saltear la verificación.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Verificar el código — no revienta la transacción en un intento fallido
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.verificar_codigo_de_cierre(
  p_consultation_id uuid,
  p_code            text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row          public.consultations%rowtype;
  v_code         text;
  v_max_intentos constant int := 5;
begin
  select * into v_row from public.consultations where id = p_consultation_id;
  if not found then
    raise exception 'Consulta no encontrada';
  end if;
  if v_row.professional_id <> auth.uid() then
    raise exception 'No autorizado';
  end if;
  if v_row.modality = 'presencial' then
    raise exception 'La consulta presencial no usa código de cierre';
  end if;
  if v_row.status not in ('in_progress', 'closing') then
    raise exception 'La consulta no está en curso ni cerrando (estado actual: %)', v_row.status;
  end if;

  -- Idempotente: reintentar tras verificar no debe consumir intentos ni fallar.
  if v_row.closing_code_verified_at is not null then
    return jsonb_build_object(
      'ok', true,
      'intentos_restantes', v_max_intentos,
      'closing_code_verified_at', v_row.closing_code_verified_at
    );
  end if;

  if v_row.closing_code_attempts >= v_max_intentos then
    return jsonb_build_object(
      'ok', false,
      'intentos_restantes', 0,
      'closing_code_verified_at', null,
      'motivo', 'intentos_agotados'
    );
  end if;

  select code into v_code
    from public.consultation_validation_codes
   where consultation_id = p_consultation_id;

  if v_code is distinct from p_code then
    update public.consultations
       set closing_code_attempts = closing_code_attempts + 1
     where id = p_consultation_id
    returning closing_code_attempts into v_row.closing_code_attempts;

    return jsonb_build_object(
      'ok', false,
      'intentos_restantes', greatest(0, v_max_intentos - v_row.closing_code_attempts),
      'closing_code_verified_at', null,
      'motivo', 'codigo_incorrecto'
    );
  end if;

  update public.consultations
     set closing_code_verified_at = now()
   where id = p_consultation_id
  returning closing_code_verified_at into v_row.closing_code_verified_at;

  return jsonb_build_object(
    'ok', true,
    'intentos_restantes', v_max_intentos,
    'closing_code_verified_at', v_row.closing_code_verified_at
  );
end;
$$;

comment on function public.verificar_codigo_de_cierre is
  'Valida el código de cierre del paciente contra consultation_validation_codes. Devuelve jsonb {ok, intentos_restantes, closing_code_verified_at, motivo} en vez de tirar excepción en un código incorrecto, para que el contador de intentos sobreviva. Tope: 5 intentos.';

revoke all on function public.verificar_codigo_de_cierre(uuid, text) from public, anon;
grant execute on function public.verificar_codigo_de_cierre(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Cerrar la consulta (closing/in_progress → completed)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.completar_cierre_de_consulta(
  p_consultation_id   uuid,
  p_closing_notes     text default null,
  p_motivo_sin_codigo text default null
)
returns public.consultations
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row      public.consultations%rowtype;
  v_duration int;
begin
  select * into v_row from public.consultations where id = p_consultation_id;
  if not found then
    raise exception 'Consulta no encontrada';
  end if;
  if v_row.professional_id <> auth.uid() then
    raise exception 'No autorizado';
  end if;
  if v_row.modality = 'presencial' then
    raise exception 'La consulta presencial se cierra con finalize_consultation, no con este camino';
  end if;
  if v_row.status not in ('closing', 'in_progress') then
    raise exception 'La consulta no está en un estado que se pueda cerrar (estado actual: %)', v_row.status;
  end if;

  -- El código de cierre es lo que habilita esta transición (pedido de Mateo).
  -- La única salida sin código es un motivo explícito y no vacío — el caso
  -- normal es que el paciente ya se fue de la llamada.
  if v_row.closing_code_verified_at is null
     and (p_motivo_sin_codigo is null or btrim(p_motivo_sin_codigo) = '') then
    raise exception 'Hace falta el código verificado o un motivo para cerrar sin código.';
  end if;

  v_duration := greatest(1, (
    extract(epoch from (now() - coalesce(v_row.started_at, v_row.closing_started_at, v_row.scheduled_at))) / 60
  )::int);

  update public.consultations
     set status                       = 'completed',
         completed_at                 = coalesce(completed_at, now()),
         professional_ended_at        = coalesce(professional_ended_at, now()),
         duration_minutes             = coalesce(duration_minutes, v_duration),
         closing_notes                = coalesce(nullif(btrim(p_closing_notes), ''), closing_notes),
         closing_skipped_code_reason  = case
                                           when v_row.closing_code_verified_at is null
                                           then btrim(p_motivo_sin_codigo)
                                           else closing_skipped_code_reason
                                         end,
         updated_at                   = now()
   where id = p_consultation_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.completar_cierre_de_consulta is
  'Cierre efectivo de una videoconsulta (closing/in_progress → completed). Exige closing_code_verified_at o un motivo no vacío. Presencial sigue usando finalize_consultation, sin cambios.';

revoke all on function public.completar_cierre_de_consulta(uuid, text, text) from public, anon;
grant execute on function public.completar_cierre_de_consulta(uuid, text, text) to authenticated;
