-- ============================================================
-- 226 — Emisión de certificados idempotente (revisión pre-prod, 2026-11-02)
-- ============================================================
-- El servicio de recetas no tiene cómo consultar si una prescripción ya existe.
-- Para no emitir dos certificados válidos para la misma consulta y tipo:
--
--   · Una sola 'pending' por (consulta, tipo): índice único. Dos clics, o la
--     app y la web a la vez → el segundo insert falla (23505) y `rcta-certificado`
--     contesta 409 CERT_EN_CURSO.
--   · `llamado_at`: la función lo escribe justo antes de llamar al servicio. Si
--     una 'pending' queda colgada:
--       - con log 'issued' en rcta_issue_log → se recupera con lo del log;
--       - con `llamado_at` y sin log → `a_revisar` (puede existir del otro lado);
--       - sin `llamado_at` → nunca salió: se cierra y se reintenta.
--     Un timeout del servicio también deja la fila `a_revisar`.
--   · Mientras haya una `a_revisar` de esa consulta y tipo, no se emite otra
--     (409 CERT_A_REVISAR). La libera el super admin desde Auditoría
--     (`liberar_certificado_a_revisar`) cuando confirmó con el servicio que no salió.
-- ============================================================

alter table public.clinical_certificates
  add column if not exists llamado_at  timestamptz,
  add column if not exists a_revisar   boolean not null default false,
  add column if not exists revisado_por uuid references public.profiles(id) on delete set null,
  add column if not exists revisado_at timestamptz;

comment on column public.clinical_certificates.llamado_at is
  'Migración 226. Cuándo se llamó al servicio de recetas. Con esto y sin respuesta registrada, la fila puede tener su certificado del otro lado.';
comment on column public.clinical_certificates.a_revisar is
  'Migración 226. Puede haber salido del otro lado (timeout o función cortada después de llamar): frena otra emisión igual hasta que el super admin lo libere.';

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

create index if not exists clinical_certificates_a_revisar_idx
  on public.clinical_certificates (consultation_id, tipo)
  where a_revisar;

-- El super admin confirmó con el servicio que no salió: se puede volver a emitir.
create or replace function public.liberar_certificado_a_revisar(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(public.get_my_role(), '') <> 'super_admin' then
    raise exception 'Sólo el super admin' using errcode = '42501';
  end if;
  update public.clinical_certificates
     set a_revisar = false, revisado_por = auth.uid(), revisado_at = now()
   where id = p_id and a_revisar;
  if not found then
    raise exception 'Ese certificado ya no está a revisar.' using errcode = 'P0002';
  end if;
  perform public._aal_escribir(null, 'certificado_liberado', 'clinical_certificates', p_id::text, null,
    jsonb_build_object('motivo', 'no salió del servicio de recetas'));
end;
$$;
revoke all on function public.liberar_certificado_a_revisar(uuid) from public, anon;
grant execute on function public.liberar_certificado_a_revisar(uuid) to authenticated;
