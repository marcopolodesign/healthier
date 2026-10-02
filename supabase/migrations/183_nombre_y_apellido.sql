-- ============================================================
-- Migration 183 — Nombre y apellido por separado en `profiles`
-- ============================================================
-- Pedido de Mateo (2026-10-02): "Que sea obligatorio el apellido cuando se arman
-- los perfiles", para profesionales y pacientes.
--
-- Por qué: hasta acá `profiles` sólo tenía `full_name`, y la receta electrónica
-- lo parte con `splitName()` (última palabra = apellido). En producción hay
-- nombres como "maria laura alcira martinez" o "DRA SEMINARIO AGUIRRE CINTIA",
-- donde no hay forma de saber cuál es el apellido — y en la receta sale mal.
--
-- Modelo:
--   · `first_name` y `last_name` nuevas, las dos opcionales a nivel base. Lo
--     obligatorio lo hace cumplir el front (alta, completar registro, edición
--     de perfil y el paso bloqueante para los usuarios que ya existían). No va
--     un NOT NULL porque hay 250+ perfiles sin el dato y porque los familiares
--     (181) y las cuentas operativas (farmacia, despacho) no lo piden.
--   · `full_name` SIGUE siendo la columna que lee todo el resto (vistas,
--     mails, push, la receta como respaldo). La mantiene sincronizada un
--     trigger: con nombre y apellido cargados, `full_name = nombre || ' ' ||
--     apellido`. Nadie tiene que acordarse de escribir las tres.
--   · Una versión vieja de la app (o cualquier cliente que siga escribiendo
--     sólo `full_name`) no rompe nada: si cambia `full_name` sin tocar las otras
--     dos y ya no coincide, nombre y apellido se vacían. Es preferible volver a
--     preguntarle a la persona que dejar un apellido viejo que la receta usaría
--     antes que el nombre nuevo.
--   · NO se infiere nada para los usuarios existentes: las columnas nacen en
--     null y cada persona confirma su apellido la próxima vez que entra.
--
-- Re-verificación (132): cambiar `full_name` le baja la verificación a un
-- profesional ya revisado. Al confirmar el apellido, el nombre armado puede
-- quedar distinto sólo en el ORDEN o en las mayúsculas ("SEMINARIO AGUIRRE
-- CINTIA" → "Cintia Seminario Aguirre"), o sin el "Dra." adelante. Eso no es
-- un cambio de identidad, así que ya no cuenta: se comparan las palabras
-- normalizadas (minúsculas, sin tildes, sin títulos, sin importar el orden).
-- Agregar, sacar o cambiar una palabra sigue mandando el perfil a revisión.
-- ============================================================

-- ── 1. Columnas ──────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name  text;

COMMENT ON COLUMN public.profiles.first_name IS
  'Nombre(s) de pila (migración 183). Con last_name cargado, full_name se arma solo con los dos.';
COMMENT ON COLUMN public.profiles.last_name IS
  'Apellido(s) (migración 183). Lo usa la receta electrónica; si está en null, la receta parte full_name como antes.';

-- ── 2. Normalizador de nombres ───────────────────────────────
-- "DRA. Seminario  Aguirre, Cintia" → "aguirre cintia seminario".
CREATE OR REPLACE FUNCTION public.nombre_normalizado(p text)
RETURNS text
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT string_agg(palabra, ' ' ORDER BY palabra)
  FROM regexp_split_to_table(
         lower(unaccent(regexp_replace(coalesce(p, ''), '[^[:alpha:][:space:]]', ' ', 'g'))),
         '\s+'
       ) AS palabra
  WHERE palabra <> ''
    AND palabra NOT IN ('dr', 'dra', 'lic', 'lica', 'prof', 'mg', 'mgtr');
$$;

COMMENT ON FUNCTION public.nombre_normalizado(text) IS
  'Palabras de un nombre en minúsculas, sin tildes ni títulos (Dr./Dra./Lic.), ordenadas. Dos nombres con el mismo resultado son la misma persona escrita de otra forma (migración 183).';

-- ── 3. full_name sincronizado ────────────────────────────────
CREATE OR REPLACE FUNCTION public.sincronizar_nombre_completo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_armado text;
BEGIN
  NEW.first_name := nullif(regexp_replace(trim(coalesce(NEW.first_name, '')), '\s+', ' ', 'g'), '');
  NEW.last_name  := nullif(regexp_replace(trim(coalesce(NEW.last_name,  '')), '\s+', ' ', 'g'), '');

  IF TG_OP = 'UPDATE'
     AND NEW.first_name IS NOT DISTINCT FROM OLD.first_name
     AND NEW.last_name  IS NOT DISTINCT FROM OLD.last_name
     AND NEW.full_name  IS DISTINCT FROM OLD.full_name THEN
    -- Sólo cambió full_name (cliente viejo, o el sync del grupo familiar).
    v_armado := nullif(trim(coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, '')), '');
    IF v_armado IS NOT NULL AND v_armado IS DISTINCT FROM trim(coalesce(NEW.full_name, '')) THEN
      NEW.first_name := NULL;
      NEW.last_name  := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.first_name IS NOT NULL AND NEW.last_name IS NOT NULL THEN
    NEW.full_name := NEW.first_name || ' ' || NEW.last_name;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sincronizar_nombre ON public.profiles;
CREATE TRIGGER profiles_sincronizar_nombre
  BEFORE INSERT OR UPDATE OF first_name, last_name, full_name ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sincronizar_nombre_completo();

-- ── 4. Alta por mail: el trigger de 095 también guarda nombre y apellido ──
-- El website y la app mandan `first_name`/`last_name` en el metadata del
-- signUp. Se sigue aceptando `full_name` solo (clientes viejos).
CREATE OR REPLACE FUNCTION public.crear_perfil_al_registrarse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if coalesce(new.raw_user_meta_data->>'role', '') = '' then
    return new;  -- Google u otro OAuth: el rol lo elige después. Ver la migración 095.
  end if;

  insert into public.profiles (id, email, full_name, first_name, last_name, role)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'first_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'last_name', '')), ''),
    new.raw_user_meta_data->>'role'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- ── 5. Re-verificación: reordenar el nombre no es cambiarlo ──
-- Misma función que la 132, salvo cómo se decide si `full_name` cambió.
CREATE OR REPLACE FUNCTION public.marcar_reverificacion_por_identidad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  cambios jsonb;
  campos  text[] := array['dni'];
begin
  if public.es_operador_de_plataforma() then
    return new;
  end if;
  if new.role is distinct from 'professional' then
    return new;
  end if;

  if public.nombre_normalizado(old.full_name) is distinct from public.nombre_normalizado(new.full_name) then
    campos := array_append(campos, 'full_name');
  end if;

  cambios := public.diff_de_campos(to_jsonb(old), to_jsonb(new), campos);
  if cambios is null then
    return new;
  end if;

  update public.professional_profiles pp
     set is_verified                 = false,
         reverification_pending      = true,
         reverification_requested_at = now(),
         reverification_changes      = coalesce(pp.reverification_changes, '[]'::jsonb) || cambios
   where pp.user_id = new.id
     and (pp.is_verified or pp.reverification_pending);

  return new;
end;
$$;
