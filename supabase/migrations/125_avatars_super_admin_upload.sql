-- El super admin sube/cambia la foto de un profesional desde el panel
-- (sidecart de Profesionales), no es dueño de esa carpeta de storage.
-- Sin esta policy, avatars_auth_upload/avatars_owner_update rechazan el
-- POST con 400 (RLS) apenas quien sube no es auth.uid() == carpeta.
-- Mismo patrón que prof_docs_super_admin_insert/update en professional-docs.

drop policy if exists avatars_super_admin_upload on storage.objects;
create policy avatars_super_admin_upload on storage.objects for insert to public
  with check (bucket_id = 'avatars' and get_my_role() = 'super_admin');

drop policy if exists avatars_super_admin_update on storage.objects;
create policy avatars_super_admin_update on storage.objects for update to public
  using (bucket_id = 'avatars' and get_my_role() = 'super_admin')
  with check (bucket_id = 'avatars' and get_my_role() = 'super_admin');
