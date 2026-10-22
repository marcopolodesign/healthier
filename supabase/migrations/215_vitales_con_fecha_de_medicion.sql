-- ═══════════════════════════════════════════════════════════════════════════
-- 215 · Signos vitales con la fecha REAL de la medición
-- ═══════════════════════════════════════════════════════════════════════════
-- Mateo (2026-10-22), sobre los signos vitales arriba de la videoconsulta:
-- "Tienen que pedirse en el momento". Hasta acá sólo existía
-- `salud_sincronizado_at` (migración 170), que es cuándo SINCRONIZÓ el teléfono,
-- no cuándo se MIDIÓ: la app manda la última muestra de HealthKit, tenga la
-- edad que tenga, así que un pulso de hace semanas se veía como "de recién".
--
-- Ahora la app (al entrar a la consulta y cuando el profesional toca "Pedir
-- signos vitales") sube cada valor junto con la fecha de su muestra, y el panel
-- del profesional muestra "medido hace X" y marca lo que no es de hoy.

alter table public.profiles
  add column if not exists fc_medido_at timestamptz,
  add column if not exists saturacion_medido_at timestamptz;

comment on column public.profiles.fc_medido_at is
  'Cuándo se midió fc_lpm (fecha de la muestra de Apple Health, no de la sincronización). Null = sin fecha conocida.';
comment on column public.profiles.saturacion_medido_at is
  'Cuándo se midió saturacion_pct (fecha de la muestra de Apple Health). Null = sin fecha conocida.';

-- Una versión vieja de la app (sin esta migración) sigue escribiendo fc_lpm /
-- saturacion_pct sin fecha. Si eso pasa, la fecha que quedó guardada sería la
-- de OTRO valor y el panel mostraría un dato viejo como recién medido. Por eso:
-- si cambia el valor y no viene una fecha nueva, la fecha se borra (el panel lo
-- muestra como "sin fecha de medición", que cuenta como viejo).
create or replace function public.vitales_fecha_sigue_al_valor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.fc_lpm is distinct from old.fc_lpm
     and new.fc_medido_at is not distinct from old.fc_medido_at then
    new.fc_medido_at := null;
  end if;
  if new.saturacion_pct is distinct from old.saturacion_pct
     and new.saturacion_medido_at is not distinct from old.saturacion_medido_at then
    new.saturacion_medido_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_vitales_fecha_sigue_al_valor on public.profiles;
create trigger profiles_vitales_fecha_sigue_al_valor
  before update of fc_lpm, saturacion_pct, fc_medido_at, saturacion_medido_at on public.profiles
  for each row execute function public.vitales_fecha_sigue_al_valor();
