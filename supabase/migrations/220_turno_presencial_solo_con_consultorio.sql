-- ============================================================
-- 220 · Un turno presencial sólo se reserva con quien atiende presencial
--
-- Incidente 2026-11-02 (prod): una paciente reservó y pagó un turno "presencial"
-- con una profesional que atiende SÓLO por video (modality_preference =
-- 'virtual', price_presencial NULL). El turno se guardó presencial, se cobró el
-- precio de video y el consultorio mostrado era una dirección sin número.
--
-- Esta guardia vive en la base porque cubre a la vez el website y la app, sin
-- esperar un build ni un OTA. Un turno presencial exige que el profesional:
--   (a) atienda presencial  → modality_preference 'presencial' o 'ambas'
--       (NULL cuenta como virtual, igual que atiendePresencial() del front);
--   (b) tenga precio presencial cargado (> 0) — el precio de video NUNCA hace
--       de precio presencial;
--   (c) tenga un consultorio con calle y número (mismo criterio que
--       direccionTieneNumero() de src/lib/geo.js).
--
-- No toca filas existentes. En UPDATE sólo vuelve a validar si cambia la
-- modalidad o el profesional (un turno viejo no se rompe porque el profesional
-- después cambió su perfil). La atención de una emergencia (emergency_id) queda
-- afuera: la crea la tripulación en el lugar y es 'presencial' por naturaleza.
-- ============================================================

-- ── "¿Esta dirección tiene calle y número?" — port a SQL de direccionTieneNumero ──
create or replace function public.direccion_con_numero(p_direccion text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_calle text;
  v_sig   text;
  v_sin   text;
begin
  if p_direccion is null then return false; end if;
  v_calle := btrim(regexp_replace(split_part(p_direccion, ',', 1), '\s+', ' ', 'g'));
  if v_calle = '' then return false; end if;

  -- Nominatim pone la altura primero: "2839, Arenales, Barrio Norte…".
  if v_calle ~ '^\d{1,5} ?[A-Za-z]?$' and position(',' in p_direccion) > 0 then
    v_sig := split_part(p_direccion, ',', 2);
    return v_sig ~ '[[:alpha:]]{3}';
  end if;

  v_sin := v_calle;
  -- piso / depto / oficina y lo que sigue
  v_sin := regexp_replace(v_sin, '\s*\y(piso|p\.|dto\.?|depto\.?|departamento|of\.?|oficina|local)\y.*$', '', 'i');
  -- calle numerada con nombre doble: "Calle 99 - Zárate", "99 - Zárate"
  v_sin := regexp_replace(v_sin, '^(?:calle|cl\.?)?\s*\d{1,4}\s*[-–—]\s*', '', 'i');
  -- "Calle 12", "Ruta 8", "Camino 3", "RN 9"
  v_sin := regexp_replace(v_sin, '\y(?:calle|cl\.?|ruta|rn|rp|camino|diagonal|diag\.?|autopista|pasaje|pje\.?)\s*n?[°º.]?\s*\d{1,3}\y', '', 'gi');
  -- "9 de Julio", "1ro de Mayo", "25 de Mayo"
  v_sin := regexp_replace(v_sin, '\y\d{1,2}(?:ro|°|º)?\s+de\s+[[:alpha:]]+', '', 'gi');

  return v_sin ~ '\d' and v_calle ~ '[[:alpha:]]{2}';
end;
$$;

comment on function public.direccion_con_numero(text) is
  'Migración 220. ¿La dirección tiene calle y número? Port de direccionTieneNumero() (src/lib/geo.js). El test scripts/test-modalidad-presencial.mjs los mantiene en paralelo.';

-- ── La guardia ────────────────────────────────────────────────────────────────
create or replace function public.validar_turno_presencial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pro professional_profiles%rowtype;
begin
  if new.modality is distinct from 'presencial' then
    return new;
  end if;
  if new.professional_id is null then
    return new;
  end if;
  -- UPDATE que no toca la modalidad ni el profesional: no se revalida.
  if tg_op = 'UPDATE'
     and old.modality is not distinct from new.modality
     and old.professional_id is not distinct from new.professional_id then
    return new;
  end if;
  -- La atención de una emergencia la crea el módulo de emergencias, en el lugar.
  if new.emergency_id is not null then
    return new;
  end if;

  -- consultations.professional_id es el id de profiles = professional_profiles.user_id
  select * into v_pro from professional_profiles where user_id = new.professional_id;
  if not found then
    return new; -- otra restricción (FK) se ocupa de un profesional inexistente
  end if;

  if v_pro.modality_preference is distinct from 'presencial'
     and v_pro.modality_preference is distinct from 'ambas' then
    raise exception 'Este profesional atiende sólo por videoconsulta. Elegí videoconsulta o buscá a otro profesional.'
      using errcode = 'check_violation', hint = 'turno_presencial_modalidad';
  end if;

  if v_pro.price_presencial is null or v_pro.price_presencial <= 0 then
    raise exception 'Este profesional no tiene precio cargado para consultas presenciales. Elegí videoconsulta o buscá a otro profesional.'
      using errcode = 'check_violation', hint = 'turno_presencial_precio';
  end if;

  if not public.direccion_con_numero(v_pro.address) then
    raise exception 'Este profesional todavía no cargó la dirección completa de su consultorio (calle y número). Elegí videoconsulta o buscá a otro profesional.'
      using errcode = 'check_violation', hint = 'turno_presencial_direccion';
  end if;

  return new;
end;
$$;

comment on function public.validar_turno_presencial() is
  'Migración 220. Rechaza modality=presencial si el profesional no atiende presencial, no tiene precio presencial o no tiene consultorio con calle y número.';

drop trigger if exists consultations_turno_presencial on public.consultations;
create trigger consultations_turno_presencial
  before insert or update of modality, professional_id on public.consultations
  for each row execute function public.validar_turno_presencial();
