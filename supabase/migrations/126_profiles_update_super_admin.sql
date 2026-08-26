-- profiles_update_own sólo deja actualizar la fila propia. El super admin
-- necesita poder actualizar avatar_url (y otros campos) de OTROS perfiles
-- desde el panel (ej: re-subir la foto de un profesional). Sin esto el
-- UPDATE de profilesService.uploadAvatar() no toca ninguna fila (RLS la
-- filtra) y el error queda mudo porque el caller no revisa `{ error }`.

drop policy if exists profiles_update_super_admin on profiles;
create policy profiles_update_super_admin on profiles for update to public
  using (get_my_role() = 'super_admin')
  with check (get_my_role() = 'super_admin');
