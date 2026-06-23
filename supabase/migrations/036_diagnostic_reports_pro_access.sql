-- Allow professionals to read lab reports for patients they have had consultations with
create policy "professionals_read_patient_reports" on diagnostic_reports
  for select
  using (
    exists (
      select 1 from consultations
      where consultations.patient_id = diagnostic_reports.patient_id
        and consultations.professional_id = auth.uid()
    )
  );
