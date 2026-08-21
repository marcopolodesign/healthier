-- ============================================================
-- 118 — Ocultar la tarjeta de "tu médico de cabecera" en el dashboard
-- ============================================================
-- El paciente referido (migración 115, `profiles.referred_by_professional_id`)
-- ve una tarjeta persistente en su dashboard con el profesional que lo trajo.
-- La X para sacarla es SÓLO visual: la atribución real (`referred_by_professional_id`)
-- sigue intacta para las métricas del profesional/super admin — lo único que
-- cambia es si el paciente la sigue viendo en su propio dashboard.
--
-- No se toca Mi Perfil: ahí el vínculo se muestra siempre que exista, sea cual
-- sea el estado de esta columna — es un dato de hecho sobre el paciente, no
-- una tarjeta promocional que se pueda "cerrar".
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS medico_cabecera_dismissed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.medico_cabecera_dismissed IS
  'El paciente cerró la tarjeta "Tu médico de cabecera" en su dashboard. No afecta referred_by_professional_id ni las métricas de referidos del profesional.';
