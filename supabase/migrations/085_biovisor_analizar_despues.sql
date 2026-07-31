-- El paciente puede completar el análisis de un estudio que YA subió.
--
-- El BioVisor pasó a separar los dos momentos: primero se sube el archivo (la
-- fila nace con `parameters = '[]'`, que es el default de la columna) y recién
-- después, si el paciente lo pide, se extraen los biomarcadores con IA. Ese
-- segundo paso es un UPDATE sobre una fila propia... y `diagnostic_reports` no
-- tenía NINGUNA política de UPDATE: sólo SELECT, INSERT y DELETE. O sea que el
-- flujo nuevo fallaba en silencio (PostgREST devuelve 0 filas afectadas, no un
-- error) y el estudio quedaba subido y sin analizar para siempre.
--
-- Acotada a lo mismo que las otras políticas del paciente: sus propias filas.
-- El profesional NO entra acá — puede leer los estudios de su paciente
-- (`professionals_read_patient_reports`, migración 036) pero no reescribirlos:
-- el estudio es del paciente y un valor de laboratorio no se edita desde la
-- app.
create policy patient_update_own_reports
  on public.diagnostic_reports
  for update
  using (auth.uid() = patient_id)
  with check (auth.uid() = patient_id);
