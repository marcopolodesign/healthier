-- ============================================================
-- Migración 207 — Lo mínimo del paciente en un pedido de consulta inmediata
-- ============================================================
-- Pedido de Mateo (2026-10-19): el llamado le llega al profesional en una hoja
-- "tipo Uber" y la solicitud "tiene que mostrar el detalle del paciente más
-- claro". Antes de aceptar, el profesional NO puede leer el perfil del paciente
-- (la RLS de `profiles` sólo se abre con una consulta compartida, y el pedido
-- todavía no tiene consulta), así que la hoja mostraba sólo el motivo.
--
-- Esta función devuelve lo justo para decidir si se toma —edad, sexo,
-- cobertura y si es para un familiar— SIN el nombre: el pedido lo ven todos los
-- elegibles a la vez (migración 191), y el nombre recién se conoce al aceptar,
-- cuando la consulta ya es de uno solo y la RLS normal deja leer el perfil.
--
-- Mismo criterio de acceso que la policy "professional_select_open_requests":
-- quien lo aceptó, o un elegible mientras el pedido está abierto.
-- ============================================================

create or replace function public.paciente_del_pedido(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
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
  'Edad, sexo, cobertura y si es para un familiar del paciente de un pedido on-demand — sin nombre. Para la hoja del llamado del profesional (2026-10-19). Mismo acceso que la RLS de ondemand_requests.';
