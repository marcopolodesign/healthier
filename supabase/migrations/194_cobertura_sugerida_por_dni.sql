-- ============================================================
-- Migration 194 — Cobertura sugerida por DNI (padrón PUCO del Ministerio)
-- ============================================================
-- Pedido de Mateo (2026-10-09): al cargar el DNI, la obra social del paciente
-- se precarga sola consultando el padrón de coberturas del Ministerio de Salud
-- (PUCO, por el bus de la Plataforma de Interoperabilidad). El paciente la
-- confirma o la cambia; nunca se pisa lo que ya cargó.
--
-- La consulta la hace la Edge Function `cobertura-sugerida` (service role). Esta
-- migración agrega:
--   1. `cobertura_rnos`: el puente entre el código del padrón (RNOS) y el
--      nombre comercial del catálogo de financiadores de recetas. El catálogo
--      de recetas NO trae el RNOS y los nombres del padrón son razones sociales
--      ("OBRA SOCIAL DE EJECUTIVOS Y DEL PERSONAL DE DIRECCION DE EMPRESAS" =
--      OSDE). Se guarda el NOMBRE del catálogo, no el idFinanciador: los ids no
--      son intercambiables entre homologación y producción (381 de ~900 apuntan
--      a entidades distintas). La función resuelve el id contra el catálogo del
--      ambiente en el que corre.
--   2. `cobertura_consultas`: registro de cada consulta — para el límite por
--      usuario (es dato personal: no se puede usar para barrer DNIs) y para que
--      el super admin vea qué obras sociales del padrón quedan sin match.
--   3. `profiles.cobertura_origen`: si la obra social cargada salió del
--      listado ('listado') o la eligió el paciente a mano ('manual').
-- ============================================================

-- ── 1. Puente RNOS → catálogo de recetas ─────────────────────
CREATE TABLE IF NOT EXISTS public.cobertura_rnos (
  rnos            text PRIMARY KEY,
  nombre_catalogo text NOT NULL,
  nota            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cobertura_rnos IS
  'Código RNOS del padrón PUCO → nombreComercial del catálogo de financiadores de recetas (migración 194). Nombre, no id: los ids cambian entre ambientes.';

ALTER TABLE public.cobertura_rnos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cobertura_rnos_admin ON public.cobertura_rnos;
CREATE POLICY cobertura_rnos_admin ON public.cobertura_rnos
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'super_admin'))
  WITH CHECK (public.get_my_role() IN ('admin', 'super_admin'));

-- Semilla: sólo los que se verificaron contra el padrón real. El resto lo
-- resuelve la coincidencia por nombre/sigla de la función, y los que no
-- matchean quedan a la vista en /super-admin para sumarlos acá.
INSERT INTO public.cobertura_rnos (rnos, nombre_catalogo, nota) VALUES
  ('614081', 'OSDE',  'OBRA SOCIAL DE EJECUTIVOS Y DEL PERSONAL DE DIRECCION DE EMPRESAS'),
  ('500807', 'PAMI',  'INSTITUTO NACIONAL DE SERVICIOS SOCIALES PARA JUBILADOS Y PENSIONADOS'),
  ('913001', 'IAPOS', 'O.S.P. SANTA FE (IAPOSS)'),
  ('910001', 'IPS INSTITUTO PROV. DE SALUD DE SALTA', 'O.S.P. SALTA (IPS) IPS SALTA'),
  ('911001', 'OSP ( OBRA SOCIAL PROVINCIA DE SAN JUAN)', 'O.S.P. SAN JUAN'),
  ('909001', 'OSEP Mendoza', 'O.S.P. MENDOZA')
ON CONFLICT (rnos) DO NOTHING;

-- ── 2. Registro de consultas ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cobertura_consultas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id     uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  consultado_por  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Hash del DNI consultado (no el DNI): alcanza para contar DNIs distintos
  -- por usuario sin guardar el dato dos veces.
  dni_hash        text NOT NULL,
  resultado       text NOT NULL
    CHECK (resultado IN ('encontrada', 'sin_match', 'sin_datos', 'error', 'limite')),
  rnos            text,
  cobertura_nombre text,
  financiador_id  integer,
  financiador_nombre text,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cobertura_consultas IS
  'Cada consulta al padrón de coberturas por DNI (migración 194). Límite por usuario y visibilidad para el super admin.';

CREATE INDEX IF NOT EXISTS cobertura_consultas_por_usuario_idx
  ON public.cobertura_consultas (consultado_por, created_at DESC);
CREATE INDEX IF NOT EXISTS cobertura_consultas_created_idx
  ON public.cobertura_consultas (created_at DESC);

ALTER TABLE public.cobertura_consultas ENABLE ROW LEVEL SECURITY;

-- Sólo lectura para la administración. Escribe la Edge Function (service role).
DROP POLICY IF EXISTS cobertura_consultas_admin_read ON public.cobertura_consultas;
CREATE POLICY cobertura_consultas_admin_read ON public.cobertura_consultas
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'super_admin'));

-- ── 3. De dónde salió la obra social del perfil ──────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cobertura_origen text
    CHECK (cobertura_origen IS NULL OR cobertura_origen IN ('listado', 'manual'));

COMMENT ON COLUMN public.profiles.cobertura_origen IS
  'listado = la precargó el padrón de coberturas y el paciente la confirmó; manual = la eligió él (migración 194).';
