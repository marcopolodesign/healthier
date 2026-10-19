-- ============================================================
-- Migración 208 — El nombre del paciente en el pedido de consulta inmediata
-- ============================================================
-- Decisión de Mateo (2026-10-19): la hoja del llamado, la solicitud y la
-- tarjeta web muestran el NOMBRE del paciente antes de aceptar, aunque el
-- pedido les llegue a todos los elegibles a la vez. Se agrega sólo el nombre a
-- lo que ya devolvía `paciente_del_pedido` (207); nada más del perfil.
-- Mismo criterio de acceso que la 207 (y que la RLS de ondemand_requests).
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
      )
    );
$$;

revoke all on function public.paciente_del_pedido(uuid) from public, anon;
grant execute on function public.paciente_del_pedido(uuid) to authenticated;

comment on function public.paciente_del_pedido(uuid) is
  'Nombre, edad, sexo, cobertura y si es para un familiar del paciente de un pedido on-demand. Para la hoja del llamado del profesional (2026-10-19; nombre desde la 208). Mismo acceso que la RLS de ondemand_requests.';
