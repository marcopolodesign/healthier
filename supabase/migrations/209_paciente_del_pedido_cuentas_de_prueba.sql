-- ============================================================
-- Migración 209 — paciente_del_pedido respeta el aislamiento de cuentas de prueba
-- ============================================================
-- Revisión pre-prod (2026-10-19): la 208 le mostraba el nombre, la edad, el
-- sexo y la cobertura de un paciente REAL a un profesional de prueba elegible
-- (y al revés), saltándose la regla de la 186. Se suma `cuentas_compatibles`
-- a la rama del pedido abierto. El que ya aceptó sigue viéndolo (si aceptó, ya
-- se cruzaron). Mismo cuerpo que la 208 en todo lo demás.
-- ============================================================

create or replace function public.paciente_del_pedido(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'nombre', coalesce(
                nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
                nullif(trim(p.full_name), '')),
    'edad', case when p.birth_date is not null
                 then extract(year from age(current_date, p.birth_date))::int end,
    'sexo', p.gender,
    'cobertura', case
                   when p.coverage_type = 'particular' then 'Particular'
                   when p.coverage_type = 'financiador' then nullif(trim(p.insurance_name), '')
                 end,
    'para_familiar', r.para_id is not null
  )
  from ondemand_requests r
  join profiles p on p.id = coalesce(r.para_id, r.patient_id)
  where r.id = p_request_id
    and (
      r.accepted_by = auth.uid()
      or (
        r.status = 'pending'
        and r.expires_at > now()
        and r.patient_id <> auth.uid()
        and public.puede_tomar_ondemand(auth.uid(), r.especialidades)
        -- 186: una cuenta de prueba no ve a un paciente real, ni al revés.
        and public.cuentas_compatibles(auth.uid(), r.patient_id)
      )
    );
$$;

revoke all on function public.paciente_del_pedido(uuid) from public, anon;
grant execute on function public.paciente_del_pedido(uuid) to authenticated;
