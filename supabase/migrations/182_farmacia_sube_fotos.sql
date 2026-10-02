-- 182 — La farmacia sube las fotos de sus productos desde el panel.
--
-- El bucket `pharmacy-products` (público, 5 MB, jpg/png/webp) ya existía en las
-- dos bases pero se había creado a mano y no estaba en ninguna migración. Se
-- declara acá de forma idempotente para que una base levantada desde el repo lo
-- tenga igual.
--
-- Hasta ahora sólo el service role podía escribir en el bucket. Se habilita
-- subir (INSERT) al administrador de la farmacia y al super admin; el operador y
-- el de sólo lectura no. Cada subida usa un nombre nuevo, así que no hace falta
-- UPDATE ni DELETE. La lectura es pública por el bucket.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pharmacy-products', 'pharmacy-products', true, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "pharmacy_products_admin_upload" ON storage.objects;
CREATE POLICY "pharmacy_products_admin_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pharmacy-products'
    AND public.get_my_role() IN ('pharmacy_admin', 'super_admin')
  );
