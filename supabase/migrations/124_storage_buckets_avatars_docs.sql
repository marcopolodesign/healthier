-- Buckets de Storage y sus políticas RLS.
-- Nunca se migraron: staging llegó a tener 0 buckets pese a tener el resto del
-- schema al día, lo que rompía en silencio cualquier subida de archivo
-- (avatares, documentos profesionales, documentos de paciente, recetas) sin
-- ningún error visible en la app. Capturado verbatim desde producción.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg','image/png','image/webp']),
  ('professional-docs', 'professional-docs', false, 10485760, array['application/pdf','image/jpeg','image/png']),
  ('patient-docs', 'patient-docs', false, 10485760, array['application/pdf','image/jpeg','image/png']),
  ('prescriptions', 'prescriptions', false, null, null)
on conflict (id) do nothing;

drop policy if exists avatars_auth_upload on storage.objects;
create policy avatars_auth_upload on storage.objects for insert to public
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists avatars_owner_update on storage.objects;
create policy avatars_owner_update on storage.objects for update to public
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects for select to public
  using (bucket_id = 'avatars');

drop policy if exists patient_docs_biovisor_shared_professional on storage.objects;
create policy patient_docs_biovisor_shared_professional on storage.objects for select to public
  using (
    bucket_id = 'patient-docs'
    and (storage.foldername(name))[2] = 'biovisor'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and has_shared_consultation(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists patient_docs_owner on storage.objects;
create policy patient_docs_owner on storage.objects for all to public
  using (bucket_id = 'patient-docs' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists prescriptions_auth_read on storage.objects;
create policy prescriptions_auth_read on storage.objects for select to public
  using (bucket_id = 'prescriptions' and auth.role() = 'authenticated');

drop policy if exists prescriptions_pro_insert on storage.objects;
create policy prescriptions_pro_insert on storage.objects for insert to public
  with check (bucket_id = 'prescriptions' and auth.role() = 'authenticated');

drop policy if exists prof_docs_owner_read on storage.objects;
create policy prof_docs_owner_read on storage.objects for select to public
  using (
    bucket_id = 'professional-docs'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role = any (array['admin','super_admin']))
    )
  );

drop policy if exists prof_docs_owner_upload on storage.objects;
create policy prof_docs_owner_upload on storage.objects for insert to public
  with check (bucket_id = 'professional-docs' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists prof_docs_super_admin_insert on storage.objects;
create policy prof_docs_super_admin_insert on storage.objects for insert to public
  with check (bucket_id = 'professional-docs' and get_my_role() = 'super_admin');

drop policy if exists prof_docs_super_admin_update on storage.objects;
create policy prof_docs_super_admin_update on storage.objects for update to public
  using (bucket_id = 'professional-docs' and get_my_role() = 'super_admin')
  with check (bucket_id = 'professional-docs' and get_my_role() = 'super_admin');
