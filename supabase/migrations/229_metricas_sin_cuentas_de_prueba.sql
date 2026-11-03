-- ============================================================
-- 229 — Las cuentas de prueba no cuentan en las métricas ni en el super admin
--
-- Pedido de Mateo (2026-11-03): las cuentas con `profiles.es_prueba` (186,
-- ampliada en la 228) no tienen que afectar "ni en las métricas, ni en el
-- superadmin, ni en ningún lado". Hasta acá sólo Usuarios, sus prospectos y
-- la pauta las sacaban; el resto del panel contaba todo.
--
-- Qué agrega:
--   1. `alguno_de_prueba(uuid[])` — un solo lugar que dice si alguna de esas
--      cuentas es de prueba.
--   2. Un campo calculado `es_prueba` en cada tabla que el super admin cuenta
--      o lista (consultas, pagos, profesionales, emergencias, pedidos, …).
--      PostgREST lo expone como una columna más, así que el front filtra con
--      `.eq('es_prueba', false)` igual que en `profiles`, también en los
--      `count` con `head: true`. Una fila es de prueba si su paciente o su
--      profesional lo es (la 186 ya impide que se mezclen).
--   3. Las tres RPC del panel que agregan del lado de la base
--      (`resumen_de_referidos`, `referidos_de_profesional`,
--      `admin_grupos_familiares`) devuelven la marca, y el resumen de
--      referidos deja de contar pacientes de prueba salvo que se le pida.
--
-- No cambia quién es de prueba ni ninguna regla de aislamiento.
-- ============================================================

create or replace function public.alguno_de_prueba(p_ids uuid[])
returns boolean
language sql
stable
-- SECURITY INVOKER a propósito: la 186 no deja que cualquiera pregunte si una
-- cuenta es de prueba (`es_cuenta_de_prueba` no es ejecutable por
-- `authenticated`). Así cada uno ve la marca sólo de los perfiles que su RLS
-- ya le deja leer; el super admin, de todos.
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = any(p_ids) and es_prueba
  );
$$;

comment on function public.alguno_de_prueba(uuid[]) is
  'Migración 229: true si alguna de esas cuentas es de prueba (profiles.es_prueba). Base de los campos calculados es_prueba(<tabla>).';

-- ── Campos calculados (PostgREST: `select=…,es_prueba` y `es_prueba=eq.false`)

create or replace function public.es_prueba(public.consultations)
returns boolean language sql stable as $$
  select public.alguno_de_prueba(array[$1.patient_id, $1.professional_id]);
$$;

create or replace function public.es_prueba(public.payments)
returns boolean language sql stable as $$
  select public.alguno_de_prueba(array[$1.patient_id, $1.professional_id]);
$$;

create or replace function public.es_prueba(public.professional_profiles)
returns boolean language sql stable as $$
  select coalesce($1.solo_pruebas, false) or public.alguno_de_prueba(array[$1.user_id]);
$$;

create or replace function public.es_prueba(public.consultation_arrivals)
returns boolean language sql stable as $$
  select public.alguno_de_prueba(array[$1.patient_id, $1.professional_id]);
$$;

create or replace function public.es_prueba(public.reviews)
returns boolean language sql stable as $$
  select public.alguno_de_prueba(array[$1.patient_id, $1.professional_id]);
$$;

create or replace function public.es_prueba(public.walk_in_queue)
returns boolean language sql stable as $$
  select public.alguno_de_prueba(array[$1.patient_id, $1.professional_id]);
$$;

create or replace function public.es_prueba(public.emergencies)
returns boolean language sql stable as $$
  select public.alguno_de_prueba(array[$1.patient_id, $1.professional_id]);
$$;

create or replace function public.es_prueba(public.emergency_tracking)
returns boolean language sql stable as $$
  select public.alguno_de_prueba(array[$1.patient_id, $1.professional_id]);
$$;

create or replace function public.es_prueba(public.ondemand_requests)
returns boolean language sql stable as $$
  select public.alguno_de_prueba(array[$1.patient_id]);
$$;

create or replace function public.es_prueba(public.derivaciones)
returns boolean language sql stable as $$
  select public.alguno_de_prueba(array[$1.patient_id, $1.profesional_destino_id]);
$$;

create or replace function public.es_prueba(public.medication_orders)
returns boolean language sql stable as $$
  select public.alguno_de_prueba(array[$1.patient_id]);
$$;

create or replace function public.es_prueba(public.cobertura_consultas)
returns boolean language sql stable as $$
  select public.alguno_de_prueba(array[$1.paciente_id]);
$$;

create or replace function public.es_prueba(public.email_log)
returns boolean language sql stable as $$
  select public.alguno_de_prueba(array[$1.usuario_id])
      or public.correo_de_prueba($1.destinatario);
$$;

create or replace function public.es_prueba(public.upload_log)
returns boolean language sql stable as $$
  select public.alguno_de_prueba(array[$1.usuario_id]);
$$;

create or replace function public.es_prueba(public.dni_completado_chequeos)
returns boolean language sql stable as $$
  select public.alguno_de_prueba(array[$1.user_id]);
$$;

-- ── RPC del panel

-- Resumen de referidos: por defecto sin pacientes de prueba en los conteos.
-- Devuelve además si el profesional es de prueba, para que el panel lo oculte.
drop function if exists public.resumen_de_referidos();
create function public.resumen_de_referidos(p_incluir_prueba boolean default false)
returns table(
  professional_id uuid, full_name text, email text, specialty text,
  referral_code text, is_verified boolean, visitas bigint, registros bigint,
  con_consulta bigint, ultima_visita timestamptz, es_prueba boolean)
language plpgsql
security definer
set search_path = public
as $function$
BEGIN
  IF public.get_my_role() NOT IN ('admin', 'super_admin') THEN
    RAISE EXCEPTION 'Sólo la administración puede ver el resumen de referidos';
  END IF;

  -- Los alias `pro_id` no son cosméticos: ver la 115 (columna homónima de un
  -- parámetro OUT → "column reference is ambiguous").
  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.email,
    pp.specialty,
    pp.referral_code,
    pp.is_verified,
    coalesce(v.visitas, 0),
    coalesce(r.registros, 0),
    coalesce(r.con_consulta, 0),
    v.ultima,
    p.es_prueba
  FROM public.profiles p
  JOIN public.professional_profiles pp ON pp.user_id = p.id
  LEFT JOIN (
    SELECT rv.professional_id AS pro_id, count(*) AS visitas, max(rv.created_at) AS ultima
    FROM public.professional_referral_visits rv
    GROUP BY rv.professional_id
  ) v ON v.pro_id = p.id
  LEFT JOIN (
    SELECT
      pr.referred_by_professional_id AS pro_id,
      count(*) AS registros,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.consultations c WHERE c.patient_id = pr.id
      )) AS con_consulta
    FROM public.profiles pr
    WHERE pr.referred_by_professional_id IS NOT NULL
      AND (p_incluir_prueba OR NOT pr.es_prueba)
    GROUP BY pr.referred_by_professional_id
  ) r ON r.pro_id = p.id
  WHERE p.role = 'professional'
    AND (p_incluir_prueba OR NOT p.es_prueba)
  ORDER BY coalesce(r.registros, 0) DESC, coalesce(v.visitas, 0) DESC, p.full_name;
END;
$function$;

-- Los referidos de un profesional: misma firma, más la marca de cada paciente.
-- No filtra acá: un profesional de prueba tiene que seguir viendo los suyos.
drop function if exists public.referidos_de_profesional(uuid);
create function public.referidos_de_profesional(p_professional_id uuid)
returns table(
  patient_id uuid, full_name text, email text, created_at timestamptz,
  consultas bigint, primera_consulta timestamptz, es_prueba boolean)
language plpgsql
security definer
set search_path = public
as $function$
BEGIN
  IF public.get_my_role() NOT IN ('admin', 'super_admin') AND auth.uid() <> p_professional_id THEN
    RAISE EXCEPTION 'Sin acceso a los referidos de ese profesional';
  END IF;

  RETURN QUERY
  SELECT
    pr.id,
    pr.full_name,
    pr.email,
    pr.created_at,
    (SELECT count(*) FROM public.consultations c WHERE c.patient_id = pr.id),
    (SELECT min(c.scheduled_at) FROM public.consultations c WHERE c.patient_id = pr.id),
    pr.es_prueba
  FROM public.profiles pr
  WHERE pr.referred_by_professional_id = p_professional_id
  ORDER BY pr.created_at DESC;
END;
$function$;

-- Grupos familiares: más la marca (titular o familiar de prueba).
drop function if exists public.admin_grupos_familiares();
create function public.admin_grupos_familiares()
returns table(
  vinculo_id uuid, titular_id uuid, titular_nombre text, titular_email text,
  familiar_id uuid, familiar_nombre text, parentesco text, familiar_dni text,
  puede_gestionar boolean, creado_at timestamptz, consultas bigint,
  ultimo_pin_at timestamptz, ultimo_ingreso_at timestamptz, es_prueba boolean)
language plpgsql
stable
security definer
set search_path = public, auth
as $function$
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'No autorizado' USING errcode = '42501';
  END IF;
  RETURN QUERY
  SELECT fm.id, t.id, t.full_name, t.email,
         f.id, f.full_name, fm.relationship, f.dni,
         fm.puede_gestionar, fm.created_at,
         (SELECT count(*) FROM public.consultations c WHERE c.patient_id = f.id),
         (SELECT max(fp.created_at) FROM public.familiar_pins fp WHERE fp.familiar_id = f.id),
         (SELECT u.last_sign_in_at FROM auth.users u WHERE u.id = f.id),
         (t.es_prueba OR f.es_prueba)
    FROM public.family_members fm
    JOIN public.profiles t ON t.id = fm.patient_id
    JOIN public.profiles f ON f.id = fm.familiar_id
   ORDER BY fm.created_at DESC;
END;
$function$;

-- Mismos permisos que tenían: las dos de referidos validan el rol adentro; la
-- de grupos familiares nunca fue ejecutable por `anon`.
revoke execute on function public.admin_grupos_familiares() from public, anon;
grant execute on function public.admin_grupos_familiares() to authenticated, service_role;
grant execute on function public.resumen_de_referidos(boolean) to authenticated, service_role;
grant execute on function public.referidos_de_profesional(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
