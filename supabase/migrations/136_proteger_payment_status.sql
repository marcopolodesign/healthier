-- ============================================================
-- 136 — Proteger consultations.payment_status
-- ============================================================
-- `consultations_access` (migración 001) es `for all` sin `with check`, así
-- que hoy CUALQUIER paciente puede insertar o actualizar su propia consulta
-- con `payment_status: 'paid'` (o cualquier otro valor) desde un PATCH/INSERT
-- directo a PostgREST, sin haber pasado por Mercado Pago — se salta el cobro
-- entero. Existía antes de la 135; la 135 (payment_exempt) sumó un valor
-- 'exempt' que legítimamente hay que poder escribir desde el cliente, así
-- que había que cerrar el resto de una vez.
--
-- Mismo patrón que 120 (proteger_factura_del_profesional): la policy amplia
-- sigue siendo la única forma de que paciente/profesional editen el resto de
-- sus propios campos, y un trigger angosta sólo esta columna.
--
-- Lo único que el cliente puede escribir en payment_status:
--   - 'pending_payment' (el default al crear una consulta, paciente o
--     profesional agendando) — es lo que ya hacen todos los `create()` hoy.
--   - 'exempt', y sólo si es el propio paciente Y su perfil tiene
--     `payment_exempt = true`.
-- Cualquier otro valor (paid, in_process, rejected, refunded) lo escribe
-- siempre la service key — mp-payment, mp-webhook, mp-capture — o el
-- super_admin desde /super-admin/consultas.
-- ============================================================

create or replace function public.proteger_payment_status_consultations()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.role() = 'service_role' or public.get_my_role() = 'super_admin' then
    return new;
  end if;

  if new.patient_id = auth.uid() and new.payment_status = 'exempt' then
    if exists (select 1 from public.profiles where id = auth.uid() and payment_exempt = true) then
      return new;
    end if;
    raise exception 'Esta cuenta no tiene la videollamada bonificada.'
      using errcode = '42501';
  end if;

  if new.payment_status = 'pending_payment'
     and (new.patient_id = auth.uid() or new.professional_id = auth.uid()) then
    return new;
  end if;

  raise exception 'No autorizado para modificar el estado de pago de esta consulta.'
    using errcode = '42501';
end;
$$;

drop trigger if exists consultations_payment_status_insert on public.consultations;
create trigger consultations_payment_status_insert
  before insert on public.consultations
  for each row
  execute function public.proteger_payment_status_consultations();

drop trigger if exists consultations_payment_status_update on public.consultations;
create trigger consultations_payment_status_update
  before update on public.consultations
  for each row
  when (old.payment_status is distinct from new.payment_status)
  execute function public.proteger_payment_status_consultations();
