-- Bulk/individual delete desde /super-admin/* (todas las tablas) descubrió que
-- varias tablas no tenían ninguna policy de DELETE — el borrado no fallaba,
-- simplemente no afectaba ninguna fila (0 rows) y la UI mostraba éxito igual.
-- clinical_access_log en particular: sin policy de DELETE el trigger
-- block_clinical_delete() ni siquiera llega a evaluarse (RLS filtra antes),
-- así que el admin veía "eliminado" sin que la Ley 26.529 se enterara.
--
-- get_my_role() (no una subquery a profiles) para evitar la recursión 42P17
-- documentada en CLAUDE.md — profiles usa esa función SECURITY DEFINER
-- justamente para poder tener policies sobre sí misma.

create policy "profiles_delete_super_admin" on profiles
  for delete
  using (get_my_role() = 'super_admin');

create policy "emergencies_delete_super_admin" on emergencies
  for delete
  using (get_my_role() = 'super_admin');

create policy "payments_delete_super_admin" on payments
  for delete
  using (get_my_role() = 'super_admin');

-- `medication_orders` la crea la rama de farmacia (`feature/farmacia-medicamentos`,
-- migraciones 103-107 y 111), que NO está mergeada a `main`. En producción esta
-- policy se creó porque allá farmacia sí se aplicó; en cualquier base levantada
-- desde el repo la tabla no existe y esta migración fallaba.
-- Se condiciona a que la tabla exista (2026-08-24): cuando farmacia se mergee,
-- la policy se crea sola; mientras tanto, la migración pasa limpia.
do $farmacia$
begin
  if to_regclass('public.medication_orders') is not null then
    execute $policy$
      create policy "medication_orders_delete_super_admin" on medication_orders
        for delete
        using (get_my_role() = 'super_admin');
    $policy$;
  else
    raise notice 'medication_orders no existe (rama de farmacia sin mergear): se omite su policy de borrado.';
  end if;
end
$farmacia$;

create policy "waitlist_delete_super_admin" on waitlist
  for delete
  using (get_my_role() = 'super_admin');

create policy "rcta_issue_log_delete_super_admin" on rcta_issue_log
  for delete
  using (get_my_role() = 'super_admin');

-- clinical_access_log SÍ necesita la policy — no para permitir el borrado
-- (block_clinical_delete() lo va a rechazar siempre) sino para que el
-- trigger llegue a correr y el admin vea el motivo real en vez de un
-- éxito falso.
create policy "clinical_access_log_delete_super_admin" on clinical_access_log
  for delete
  using (get_my_role() = 'super_admin');
