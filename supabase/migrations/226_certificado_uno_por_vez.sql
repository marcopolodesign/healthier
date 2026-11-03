-- ============================================================
-- 226 — Un certificado a la vez por consulta y tipo (revisión pre-prod, 2026-11-02)
-- ============================================================
-- `rcta-certificado` inserta la fila en 'pending' antes de llamar al servicio.
-- Dos clics, o la app y la web a la vez, podían dejar dos 'pending' y emitir
-- dos certificados válidos. Con este índice el segundo insert falla (23505) y
-- la función contesta 409 CERT_EN_CURSO. Una 'pending' colgada (más de 5 min)
-- la cierra la propia función antes de insertar.
-- ============================================================

-- Por si quedó alguna colgada de las pruebas: sin esto el índice no se crea.
update public.clinical_certificates c
   set status = 'error', error_detalle = 'Quedó sin terminar (la emisión se cortó).'
 where c.status = 'pending'
   and exists (select 1 from public.clinical_certificates o
                where o.consultation_id = c.consultation_id and o.tipo = c.tipo
                  and o.status = 'pending' and o.id <> c.id);

create unique index if not exists clinical_certificates_uno_pendiente_idx
  on public.clinical_certificates (consultation_id, tipo)
  where status = 'pending';
