-- ============================================================
-- 120 — Proteger la factura del profesional
-- ============================================================
-- `consultations_access` (migración 001) es `for all` para las dos partes de
-- la consulta: `patient_id = auth.uid() or professional_id = auth.uid() or
-- admin/super_admin`. Le sirve al paciente para el resto de la fila que la
-- 119 asume que sólo escribe el profesional — `invoice_url`/
-- `invoice_uploaded_at` son la factura que el profesional le sube a
-- Healthier, y hoy el paciente puede pisarla con un PATCH a
-- `/consultations?id=eq.<x>` con esas dos columnas, porque la policy no
-- distingue campo por campo.
--
-- Se resuelve con un trigger y no angostando la policy: `consultations_access`
-- sigue siendo la única forma de que el paciente edite el resto de sus propios
-- campos de la consulta, y separar la factura en su propia tabla es más
-- cambio del que amerita esto hoy. El trigger sólo se dispara cuando esas dos
-- columnas cambian (`when` de abajo) — el resto de los updates de
-- `consultations` (estado, cobertura, motivo, etc.) no lo despiertan.
--
-- Mismo patrón de rol que 097/109/116: `public.get_my_role()` para
-- admin/super_admin, `auth.role() = 'service_role'` para lo que corre con la
-- service key (Edge Functions, jobs) sin sesión de usuario.
-- ============================================================

create or replace function public.proteger_factura_del_profesional()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Service role (jobs/Edge Functions) y super_admin pasan siempre.
  if auth.role() = 'service_role' or public.get_my_role() = 'super_admin' then
    return new;
  end if;

  -- Cualquier otro caso (incluido el paciente, que también matchea
  -- `consultations_access`) sólo puede tocar estas columnas si es el
  -- profesional a cargo de esta consulta.
  if auth.uid() is distinct from old.professional_id then
    raise exception 'Sólo el profesional a cargo de la consulta puede modificar su factura.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists consultations_proteger_factura on public.consultations;
create trigger consultations_proteger_factura
  before update on public.consultations
  for each row
  when (
    old.invoice_url is distinct from new.invoice_url
    or old.invoice_uploaded_at is distinct from new.invoice_uploaded_at
  )
  execute function public.proteger_factura_del_profesional();
