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

create policy "medication_orders_delete_super_admin" on medication_orders
  for delete
  using (get_my_role() = 'super_admin');

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
