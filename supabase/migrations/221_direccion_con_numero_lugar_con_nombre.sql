-- ============================================================
-- 221 · direccion_con_numero acepta "<lugar>, <altura>, <calle>, …"
--
-- Bug de la 220 (2026-11-02, prod): el formato de Nominatim cuando la dirección
-- empieza con un lugar con nombre — "IFER, 2259, Marcelo T. de Alvear, Barrio
-- Norte…", "Centro Médico Santa Paula, 1399, Avenida Daniel M. Cazón…" — se
-- rechazaba, porque la función sólo miraba el primer segmento. Tiene calle y
-- número: un segmento con letras, uno que es sólo una altura (1 a 5 dígitos, letra
-- opcional) y uno con la calle. Una profesional presencial (IFER 2259) quedaba
-- afuera de presencial.
--
-- Sigue siendo inválido: "Coronel Ramón Lorenzo Falcón, Flores, …", "Lavalleja,
-- Villa Crespo…", "9 de Julio, Martin, Rosario…", "Primera Junta, Avenida
-- Rivadavia…", "Buenos Aires, Argentina". Idéntico a direccionTieneNumero()
-- (website src/lib/geo.js), direccionConNumero() (src/lib/modalidad.js) y
-- direccionTieneNumero() de la app (src/lib/direccion.ts).
-- ============================================================
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
  v_s1    text;
  v_s2    text;
begin
  if p_direccion is null then return false; end if;
  v_calle := btrim(regexp_replace(split_part(p_direccion, ',', 1), '\s+', ' ', 'g'));
  if v_calle = '' then return false; end if;

  -- Nominatim con lugar con nombre: "IFER, 2259, Marcelo T. de Alvear, Barrio Norte" —
  -- <lugar>, <altura sola>, <calle>.
  v_s1 := btrim(regexp_replace(split_part(p_direccion, ',', 2), '\s+', ' ', 'g'));
  v_s2 := btrim(regexp_replace(split_part(p_direccion, ',', 3), '\s+', ' ', 'g'));
  if v_calle ~ '[[:alpha:]]{2}'
     and v_s1 ~ '^\d{1,5} ?[A-Za-z]?$'
     and v_s2 ~ '[[:alpha:]]{3}'
     and array_length(string_to_array(p_direccion, ','), 1) >= 3 then
    return true;
  end if;

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
  'Migración 221 (reemplaza la de la 220). ¿La dirección tiene calle y número? Acepta "<lugar>, <altura>, <calle>…". Port de direccionTieneNumero() (src/lib/geo.js). Los tests scripts/test-modalidad-presencial.mjs y test-direccion-consultorio.mjs los mantienen en paralelo.';
