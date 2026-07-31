-- ─────────────────────────────────────────────────────────────────────────────
-- Verticales configurables: habilitación y precio de on-demand.
--
-- Hasta ahora `comingSoon` vivía hardcodeado en `src/lib/verticals.js`, así que
-- habilitar Nutrición era editar código y desplegar. Y el precio de una consulta
-- on-demand salía del profesional matcheado (`priceVideo ?? sessionPrice`), o
-- sea que el paciente pagaba distinto según a quién le tocara.
--
-- Decisiones de Mateo (2026-07-31):
--   • El precio on-demand lo fija la vertical y PISA el del profesional. El
--     precio propio de cada profesional sigue valiendo para lo que no es
--     on-demand (turnos agendados, presencial/virtual).
--   • Aplica sólo a on-demand.
--   • Una vertical habilitada sin profesionales disponibles se muestra igual y
--     avisa; sirve para medir demanda. (Eso es front, no se modela acá.)
--
-- ── Qué va a la base y qué se queda en código ────────────────────────────────
-- Acá va sólo la POLÍTICA COMERCIAL: si la vertical está habilitada y cuánto
-- sale su consulta inmediata. Eso es lo que cambia sin desplegar.
--
-- La IDENTIDAD VISUAL (nombre, ícono, colores, imagen) se queda en
-- `src/lib/verticals.js` a propósito: el ícono es un componente de Phosphor y no
-- se serializa — guardarlo como texto obligaría igual a mantener un mapa
-- string→componente en código, o sea la misma tabla partida en dos lugares. Y
-- los colores/imágenes son decisiones de diseño que viajan con un deploy, no
-- perillas de operación. Consecuencia buscada: **crear una vertical nueva sigue
-- requiriendo código** (necesita ícono y paleta), pero habilitarla y ponerle
-- precio no.
--
-- El `id` es el mismo slug que ya usa el front ('clinica', 'pediatria', …) para
-- que el merge sea directo y no haga falta una tabla de equivalencias.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vertical_settings (
  id             text PRIMARY KEY,
  enabled        boolean NOT NULL DEFAULT false,
  -- Precio de la consulta inmediata, en ARS. NULL = sin precio definido: la
  -- vertical no se puede ofrecer on-demand aunque esté habilitada, y el front
  -- lo dice en vez de crear una consulta sin precio.
  ondemand_price numeric CHECK (ondemand_price IS NULL OR ondemand_price > 0),
  sort_order     int NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES public.profiles(id)
);

COMMENT ON TABLE public.vertical_settings IS
  'Habilitación y precio on-demand por vertical, editable desde /super-admin/verticales. La identidad visual (nombre, ícono, colores) vive en src/lib/verticals.js.';
COMMENT ON COLUMN public.vertical_settings.ondemand_price IS
  'Precio de la consulta inmediata en ARS. Pisa el precio del profesional para on-demand; los turnos agendados siguen usando el del profesional.';

-- Semilla: refleja EXACTAMENTE el estado actual, no un estado deseado.
--   • clinica y pediatria habilitadas (es lo que hoy no tiene `comingSoon`).
--   • $1000 porque es lo que cobran hoy los profesionales con MP conectado, o
--     sea que el precio que ve el paciente no cambia el día del deploy.
--   • El resto deshabilitadas y sin precio: al habilitarlas hay que ponerle uno.
INSERT INTO public.vertical_settings (id, enabled, ondemand_price, sort_order) VALUES
  ('clinica',     true,  1000, 1),
  ('pediatria',   true,  1000, 2),
  ('nutricion',   false, NULL, 3),
  ('mente',       false, NULL, 4),
  ('fisico',      false, NULL, 5),
  ('veterinaria', false, NULL, 6),
  ('preparador',  false, NULL, 7)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.vertical_settings ENABLE ROW LEVEL SECURITY;

-- Lectura para cualquiera: el paciente necesita saber qué verticales hay y a qué
-- precio antes de decidir, y esto no expone nada sensible.
CREATE POLICY "vertical_settings_select_all"
  ON public.vertical_settings FOR SELECT
  USING (true);

-- Escritura sólo super_admin. Se usa `get_my_role()` (SECURITY DEFINER) y no una
-- consulta a `profiles`: la invariante de RLS del proyecto — consultar `profiles`
-- desde una policy provoca recursión infinita (42P17).
CREATE POLICY "vertical_settings_update_super_admin"
  ON public.vertical_settings FOR UPDATE
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

CREATE TRIGGER vertical_settings_updated_at
  BEFORE UPDATE ON public.vertical_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
