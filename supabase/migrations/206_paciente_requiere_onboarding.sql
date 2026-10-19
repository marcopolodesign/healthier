-- 206 · El onboarding del paciente es obligatorio SÓLO para los nuevos (Mateo, 2026-10-19)
--
-- Decisión: el paciente nuevo no puede usar la web ni la app hasta completar
-- consentimiento, datos (DNI/sexo/nacimiento) y cobertura. A los que ya
-- existían no se les muestra el wizard ni se les vuelve a pedir el
-- consentimiento.
--
-- "Nuevo" = el perfil de paciente titular se creó DESPUÉS de esta migración.
-- Corte claro y sin depender de fechas en el código:
--   · las filas que ya existen quedan en false (backfill de abajo);
--   · toda fila nueva de paciente titular entra en true por el trigger, salvo
--     que quien inserta mande false a propósito (scripts de seed/control).
-- Los familiares a cargo (titular_id) nunca: los completa el titular.
--
-- La base no bloquea nada: es una marca que leen la web (RequireOnboarding en
-- App.jsx) y la app (app/index.tsx + el layout de tabs). El bloqueo termina
-- cuando `onboarding_completado_at` tiene fecha (205).

alter table public.profiles add column if not exists requiere_onboarding boolean;

update public.profiles set requiere_onboarding = false where requiere_onboarding is null;

comment on column public.profiles.requiere_onboarding is
  'true = paciente creado después de la 206: debe completar el onboarding por pasos antes de usar la plataforma (hasta onboarding_completado_at). false = existente o exento.';

create or replace function public.marcar_paciente_nuevo()
returns trigger
language plpgsql
as $$
begin
  if new.requiere_onboarding is null then
    new.requiere_onboarding := (new.role = 'patient' and new.titular_id is null);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_marcar_paciente_nuevo on public.profiles;
create trigger profiles_marcar_paciente_nuevo
  before insert on public.profiles
  for each row execute function public.marcar_paciente_nuevo();

-- Un cliente no puede apagarse la marca a sí mismo para saltear el wizard
-- (sí el super admin y el service role).
create or replace function public.proteger_requiere_onboarding()
returns trigger
language plpgsql
as $$
begin
  if new.requiere_onboarding is distinct from old.requiere_onboarding
     and auth.uid() is not null
     and coalesce(public.get_my_role(), '') <> 'super_admin' then
    new.requiere_onboarding := old.requiere_onboarding;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_proteger_requiere_onboarding on public.profiles;
create trigger profiles_proteger_requiere_onboarding
  before update of requiere_onboarding on public.profiles
  for each row execute function public.proteger_requiere_onboarding();
