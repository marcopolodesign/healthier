-- El profesional no podía REEMPLAZAR un documento ya subido.
--
-- Reportado por Martín Zaidman (psicología, martin.zaidman1@gmail.com) el
-- 2026-09-01: al reenviar el formulario de onboarding le aparecía
-- "new row violates row-level security policy". Sus 6 documentos estaban en
-- `professional-docs` desde el 2026-08-28, pero `professional_profiles` seguía
-- vacío y `profiles.onboarding_step` clavado en 4 — el envío nunca terminaba.
--
-- Causa: `professionalService.uploadDocument()` sube a un path determinístico
-- (`<user_id>/titulo.pdf`) con `{ upsert: true }`. La primera vez eso es un
-- INSERT y lo cubre `prof_docs_owner_upload`. La segunda vez el objeto ya
-- existe, así que Storage hace un UPDATE — y en este bucket la única policy de
-- UPDATE es `prof_docs_super_admin_update` (migración 097). El dueño no tenía
-- ninguna, así que cualquier reenvío del wizard fallaba en el primer archivo
-- repetido y se llevaba puesto todo el submit (`Promise.all`).
--
-- Se ve claro en su carpeta: el 2026-08-30 pudo subir `dni.jpeg` (path nuevo,
-- INSERT) pero no pudo pisar `dni.pdf` ni ninguno de los otros cinco.
--
-- La contraparte ya existía para `avatars` desde la migración 124
-- (`avatars_owner_update`), que es justo por qué la foto de perfil sí se podía
-- cambiar y los documentos no.
drop policy if exists prof_docs_owner_update on storage.objects;
create policy prof_docs_owner_update on storage.objects for update to public
  using (
    bucket_id = 'professional-docs'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'professional-docs'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
