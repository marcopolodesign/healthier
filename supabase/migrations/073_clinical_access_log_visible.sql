-- ─────────────────────────────────────────────────────────────────────────────
-- El rastro de acceso a la historia clínica, visible para el super admin.
--
-- `clinical_access_log` existe desde la migración 033 pero hasta ahora nadie lo
-- escribía NI podía leerlo: no tenía ninguna policy de SELECT. Un rastro de
-- auditoría que nadie puede consultar no sirve para auditar nada — Ley 26.529
-- Art. 14 y Ley 25.326 Art. 9 piden poder demostrar quién accedió a datos de
-- salud, y eso implica que alguien lo pueda mirar.
--
-- Sólo el super admin. El asiento guarda METADATOS (quién, qué recurso, cuándo),
-- nunca contenido clínico: no expone la historia clínica de nadie.
-- ─────────────────────────────────────────────────────────────────────────────

create policy "cal_super_admin_read"
  on public.clinical_access_log for select
  using (public.get_my_role() = 'super_admin');

-- La consulta natural del panel es "los últimos accesos" y "todo lo que se hizo
-- sobre este paciente".
create index if not exists idx_cal_accessed_at on public.clinical_access_log (accessed_at desc);
create index if not exists idx_cal_patient     on public.clinical_access_log (patient_id, accessed_at desc);
