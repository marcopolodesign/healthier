-- 205 · Onboarding del paciente por pasos (Mateo, 2026-10-18)
--
-- "Para el registro de paciente necesitamos los steps como tenemos en el de
-- profesionales (adaptado) y poder ver eso en el súper admin."
--
-- Qué guarda la base y por qué:
--
-- 1. consentimiento_at / consentimiento_version — hasta hoy el paciente tildaba
--    las tres casillas de consentimiento (datos de salud, Ley 25.326, acceso
--    del equipo médico) y eso NO quedaba en ningún lado: en la web era estado
--    de React y en la app un valor en el SecureStore del teléfono. No había
--    forma de mostrar cuándo consintió alguien ni qué versión del texto.
--
-- 2. paciente_paso_onboarding — hasta qué paso del wizard llegó (0-indexed,
--    igual a PASOS_PACIENTE en lib/pacienteOnboarding.js). NO se reusa
--    `onboarding_step`: ese tiene triggers (112) que escriben cada avance en la
--    bitácora del PROFESIONAL, y un paciente aparecería ahí.
--
-- 3. onboarding_completado_at — cuándo terminó el wizard (llegó al final,
--    guardando o salteando los pasos opcionales).
--
-- Lo que falta de cada paciente NO se guarda: se deriva de los datos que ya
-- existen (dni, gender, birth_date, coverage_type, …), igual que
-- profileCompleteness.js del profesional. Así no hay un "completo" que se
-- desincronice del dato real.
--
-- Aditiva: columnas nullable, sin backfill (los datos actuales son de prueba,
-- ver CLAUDE.md raíz). Los pacientes existentes quedan con todo en NULL y el
-- wizard les pide sólo lo que les falte.

alter table public.profiles
  add column if not exists consentimiento_at        timestamptz,
  add column if not exists consentimiento_version   text,
  add column if not exists paciente_paso_onboarding smallint,
  add column if not exists onboarding_completado_at timestamptz;

comment on column public.profiles.consentimiento_at is
  'Cuándo el paciente aceptó el consentimiento (datos de salud, Ley 25.326, equipo tratante). NULL = nunca lo aceptó en la base (las altas anteriores a la 205 lo aceptaban sin guardarlo).';
comment on column public.profiles.consentimiento_version is
  'Versión del texto de consentimiento aceptado (CONSENT_VERSION en web y app).';
comment on column public.profiles.paciente_paso_onboarding is
  'Último paso del onboarding del paciente alcanzado (0-indexed, PASOS_PACIENTE en lib/pacienteOnboarding.js). Nunca retrocede. NULL = no abrió el wizard nuevo.';
comment on column public.profiles.onboarding_completado_at is
  'Cuándo el paciente terminó el onboarding por pasos.';

-- El paso nunca retrocede: volver atrás en el wizard, o abrirlo desde otro
-- dispositivo, no puede borrar hasta dónde había llegado.
create or replace function public.paciente_paso_onboarding_monotono()
returns trigger
language plpgsql
as $$
begin
  if new.paciente_paso_onboarding is not null and old.paciente_paso_onboarding is not null
     and new.paciente_paso_onboarding < old.paciente_paso_onboarding then
    new.paciente_paso_onboarding := old.paciente_paso_onboarding;
  end if;
  -- Una vez completado, queda la primera fecha.
  if old.onboarding_completado_at is not null then
    new.onboarding_completado_at := old.onboarding_completado_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_paciente_paso_monotono on public.profiles;
create trigger profiles_paciente_paso_monotono
  before update of paciente_paso_onboarding, onboarding_completado_at on public.profiles
  for each row execute function public.paciente_paso_onboarding_monotono();
