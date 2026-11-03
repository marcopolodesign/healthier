-- ============================================================
-- 225 — Un DNI que faltaba y se completa se chequea con SISA, no re-verifica
-- ============================================================
-- Decisión de Mateo (2026-11-02). Hasta acá (migración 132) cargar el DNI
-- contaba como "cambio sensible" aun si estaba VACÍO: un profesional verificado
-- que lo completaba desde el aviso del Recetario pasaba a pendiente en medio de
-- la consulta y la app le mostraba "Te faltan subir documentos" en vez de su
-- agenda.
--
-- Regla nueva, SÓLO para un DNI vacío que se completa (con el resto igual):
--   1. No se baja la verificación en el momento: queda un chequeo `pendiente`
--      y se llama a la Edge Function `dni-completado`, que consulta REFEPS
--      (SISA) por DNI con el mismo criterio que `sisa-verify`.
--   2. Coincide (la matrícula declarada figura habilitada) → sigue verificado.
--   3. No coincide, no está en SISA o SISA no responde → a revisión, igual que
--      antes (`reverification_pending`, con el DNI en `reverification_changes`).
--   4. Los dos casos dejan un aviso para el super admin (esta tabla, que se ve
--      en /super-admin/profesionales) y un asiento en `admin_action_log`.
-- Cambiar un DNI que YA existía sigue igual que hoy: revisión inmediata.
--
-- Si la función nunca llega a correr (pg_net caído), el cron de abajo resuelve
-- los chequeos con más de 10 minutos como "sin respuesta" → revisión. Mientras
-- tanto el profesional sigue verificado: es la misma ventana que tenía antes de
-- cargar el DNI.
-- ============================================================

create table if not exists public.dni_completado_chequeos (
  id                      uuid primary key default gen_random_uuid(),
  created_at              timestamptz not null default now(),
  professional_profile_id uuid not null references public.professional_profiles(id) on delete cascade,
  user_id                 uuid not null references public.profiles(id) on delete cascade,
  dni                     text not null,
  resultado               text not null default 'pendiente'
                          check (resultado in ('pendiente', 'coincide', 'no_coincide', 'sin_respuesta')),
  -- Detalle legible ("no está en REFEPS", "matrícula 112233 no figura",
  -- "el bus no respondió…") y lo que contestó REFEPS, para el legajo.
  detalle                 text,
  refeps                  jsonb,
  resuelto_at             timestamptz,
  -- El super admin lo marca como visto: el aviso deja de figurar arriba.
  visto_por               uuid references public.profiles(id) on delete set null,
  visto_at                timestamptz
);

comment on table public.dni_completado_chequeos is
  'Migración 225: un profesional verificado completó un DNI que tenía vacío. Se chequea contra REFEPS (dni-completado) en vez de re-verificar en el acto. Aviso para el super admin.';

create index if not exists dni_completado_chequeos_sin_ver_idx
  on public.dni_completado_chequeos (created_at desc) where visto_at is null;
create index if not exists dni_completado_chequeos_pendientes_idx
  on public.dni_completado_chequeos (created_at) where resultado = 'pendiente';

alter table public.dni_completado_chequeos enable row level security;

drop policy if exists dni_completado_chequeos_admin_lee on public.dni_completado_chequeos;
create policy dni_completado_chequeos_admin_lee on public.dni_completado_chequeos
  for select using (public.get_my_role() in ('admin', 'super_admin'));

-- Sólo se marca como visto por RPC: con una policy de update se podría
-- reescribir el resultado.
create or replace function public.marcar_aviso_dni_visto(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'super_admin') then
    raise exception 'Sólo la administración' using errcode = '42501';
  end if;
  update public.dni_completado_chequeos
     set visto_por = auth.uid(), visto_at = now()
   where id = p_id and visto_at is null;
end;
$$;
revoke all on function public.marcar_aviso_dni_visto(uuid) from public, anon;
grant execute on function public.marcar_aviso_dni_visto(uuid) to authenticated;

-- ── El resultado: lo escribe sólo la Edge Function (o el cron) ──────────────
-- `p_resultado` distinto de 'coincide' manda a revisión, con el mismo formato
-- de `reverification_changes` que la 132. Idempotente: un chequeo ya resuelto
-- no se vuelve a aplicar.
create or replace function public.resolver_chequeo_dni(
  p_id uuid, p_resultado text, p_detalle text, p_refeps jsonb default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.dni_completado_chequeos%rowtype;
  v_nombre text;
  v_a_revision integer := 0;
begin
  -- Quién la puede llamar lo deciden los grants de abajo: sólo service_role
  -- (la Edge Function) y el dueño (el cron).
  if p_resultado not in ('coincide', 'no_coincide', 'sin_respuesta') then
    raise exception 'resultado inválido: %', p_resultado;
  end if;

  select * into c from public.dni_completado_chequeos where id = p_id for update;
  if not found then return 'no_existe'; end if;
  if c.resultado <> 'pendiente' then return c.resultado; end if;

  update public.dni_completado_chequeos
     set resultado = p_resultado, detalle = left(p_detalle, 500), refeps = p_refeps, resuelto_at = now()
   where id = p_id;

  if p_resultado <> 'coincide' then
    update public.professional_profiles pp
       set is_verified                 = false,
           reverification_pending      = true,
           reverification_requested_at = now(),
           reverification_changes      = coalesce(pp.reverification_changes, '[]'::jsonb)
             || jsonb_build_array(jsonb_build_object('campo', 'dni', 'antes', null, 'ahora', c.dni, 'sisa', p_resultado))
     where pp.id = c.professional_profile_id
       and (pp.is_verified or pp.reverification_pending)
       -- Si el DNI cambió después del chequeo, ese cambio ya fue por su propio
       -- camino (revisión inmediata): el resultado viejo no lo vuelve a tocar.
       and exists (select 1 from public.profiles pr
                    where pr.id = c.user_id and btrim(coalesce(pr.dni, '')) = c.dni);
    get diagnostics v_a_revision = row_count;
  end if;

  select coalesce(nullif(full_name, ''), email) into v_nombre from public.profiles where id = c.user_id;
  perform public._aal_escribir(null, 'dni_completado', 'professional_profiles',
    c.professional_profile_id::text, c.user_id,
    jsonb_build_object('sisa', p_resultado, 'detalle', left(p_detalle, 300),
                       -- El estado real del legajo después de resolver, no el que se supone.
                       'sigue_verificado', coalesce((select pp.is_verified from public.professional_profiles pp
                                                      where pp.id = c.professional_profile_id), false),
                       -- false: este resultado no tocó el legajo (el DNI cambió después del
                       -- chequeo, o ya no estaba verificado ni pendiente).
                       'aplicado', p_resultado = 'coincide' or v_a_revision > 0));
  return p_resultado;
end;
$$;
revoke all on function public.resolver_chequeo_dni(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.resolver_chequeo_dni(uuid, text, text, jsonb) to service_role;

-- ── El trigger de identidad (132/183), con la excepción del DNI vacío ───────
create or replace function public.marcar_reverificacion_por_identidad()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cambios jsonb;
  campos  text[] := array['dni'];
  v_pp    public.professional_profiles%rowtype;
  v_id    uuid;
begin
  if public.es_operador_de_plataforma() then
    return new;
  end if;
  if new.role is distinct from 'professional' then
    return new;
  end if;

  if public.nombre_normalizado(old.full_name) is distinct from public.nombre_normalizado(new.full_name) then
    campos := array_append(campos, 'full_name');
  end if;

  -- 225: DNI vacío que se completa, sin otro cambio de identidad, en un
  -- profesional verificado → chequeo con SISA en vez de revisión inmediata.
  if nullif(btrim(coalesce(old.dni, '')), '') is null
     and nullif(btrim(coalesce(new.dni, '')), '') is not null
     and not ('full_name' = any(campos)) then
    select * into v_pp from public.professional_profiles where user_id = new.id;
    if found and v_pp.is_verified and not v_pp.reverification_pending then
      insert into public.dni_completado_chequeos (professional_profile_id, user_id, dni)
      values (v_pp.id, new.id, btrim(new.dni))
      returning id into v_id;
      perform public.llamar_edge_function('dni-completado', jsonb_build_object('chequeoId', v_id));
      return new;
    end if;
  end if;

  cambios := public.diff_de_campos(to_jsonb(old), to_jsonb(new), campos);
  if cambios is null then
    return new;
  end if;

  update public.professional_profiles pp
     set is_verified                 = false,
         reverification_pending      = true,
         reverification_requested_at = now(),
         reverification_changes      = coalesce(pp.reverification_changes, '[]'::jsonb) || cambios
   where pp.user_id = new.id
     and (pp.is_verified or pp.reverification_pending);

  return new;
end;
$$;

-- ── Red de seguridad: chequeos que nunca se resolvieron ─────────────────────
create or replace function public.resolver_chequeos_dni_vencidos()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  n integer := 0;
begin
  for r in select id from public.dni_completado_chequeos
            where resultado = 'pendiente' and created_at < now() - interval '10 minutes'
  loop
    perform public.resolver_chequeo_dni(r.id, 'sin_respuesta', 'El chequeo con SISA no llegó a correr.');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.resolver_chequeos_dni_vencidos() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'dni-completado-vencidos';
    perform cron.schedule('dni-completado-vencidos', '*/10 * * * *',
      'select public.resolver_chequeos_dni_vencidos()');
  end if;
end $$;
