-- ─────────────────────────────────────────────────────────────────────────────
-- Búsqueda de profesionales por nombre, insensible a acentos.
--
-- Pedido de Mateo (2026-07-31): buscar por nombre desde el inicio del paciente,
-- mostrando **sólo** a los que tienen Mercado Pago conectado.
--
-- Por qué una función y no un `ilike` desde PostgREST: el `ilike` de Postgres es
-- insensible a mayúsculas pero **no a acentos**, y esto se probó contra la base
-- antes de escribirlo:
--
--     'Márquez'  → 1 resultado
--     'marquez'  → 0
--     'nicolas'  → 0   (el profesional es "Dr. Nicolás Peña")
--
-- En un padrón de apellidos argentinos —Márquez, Nicolás, Martín, Peña— eso
-- significa que la búsqueda falla justo con los nombres más comunes, y falla en
-- silencio: el paciente ve "sin resultados" y concluye que el profesional no
-- existe. `unaccent` lo resuelve del lado del servidor.
--
-- El filtro de Mercado Pago vive ACÁ y no en el cliente a propósito: hoy hay 15
-- profesionales verificados y activos y sólo 6 con MP conectado. Traer los 15
-- para descartar 9 en el browser es mandarle al paciente datos de gente que no
-- puede contratar.
--
-- `security invoker`: la función no amplía permisos, corre con las RLS del que
-- llama. Devuelve lo mismo que ya devuelve la query directa que usa la app.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.buscar_profesionales_cobrables(
  p_texto          text     DEFAULT NULL,
  p_especialidades text[]   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  -- Se devuelve jsonb en vez de una TABLE con columnas declaradas para no atar
  -- la firma a los tipos de `professional_profiles`: cualquier columna que se
  -- agregue mañana viaja sola, sin migrar la función.
  SELECT COALESCE(jsonb_agg(fila.j ORDER BY fila.orden DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT
      to_jsonb(pp.*) || jsonb_build_object(
        'profiles', jsonb_build_object(
          'full_name',  p.full_name,
          'avatar_url', p.avatar_url,
          'email',      p.email
        )
      ) AS j,
      pp.average_rating AS orden
    FROM public.professional_profiles pp
    JOIN public.profiles p ON p.id = pp.user_id
    WHERE pp.is_verified
      AND pp.is_active
      -- Si no puede cobrar, no puede atender: no tiene sentido mostrarlo.
      AND pp.mp_connected
      AND (p_especialidades IS NULL OR pp.specialty = ANY (p_especialidades))
      AND (
        p_texto IS NULL
        OR btrim(p_texto) = ''
        OR extensions.unaccent(p.full_name)
             ILIKE '%' || extensions.unaccent(btrim(p_texto)) || '%'
      )
  ) fila;
$$;

COMMENT ON FUNCTION public.buscar_profesionales_cobrables IS
  'Profesionales verificados, activos y con Mercado Pago conectado. Busca por nombre sin distinguir acentos ni mayúsculas. SECURITY INVOKER: respeta las RLS de quien llama.';

REVOKE ALL ON FUNCTION public.buscar_profesionales_cobrables(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_profesionales_cobrables(text, text[]) TO anon, authenticated;
