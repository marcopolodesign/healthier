-- ─────────────────────────────────────────────────────────────────────────────
-- Duración del turno (slot) configurable desde super admin.
--
-- Pedido del CEO en una call: "poder configurar la duración de los turnos
-- (los slots) en super admin". Hoy está hardcodeada en 15 minutos en
-- `src/pages/patient/ReservarConsulta.jsx` (`SLOT_DURATION_MINUTES`), que es
-- el ÚNICO lugar del código que genera la grilla horaria contra
-- `professional_schedules` y filtra los horarios ya reservados (así se evita
-- el doble booking hoy: comparando el `HH:MM` exacto contra las consultas
-- activas de ese profesional y ese día). No hay ningún otro generador de
-- slots ni ninguna constraint de base de datos que dependa de este número —
-- se confirmó relevando todo `website/src` y `website/supabase` antes de
-- escribir esta migración.
--
-- ── Dónde vive el valor ──────────────────────────────────────────────────────
-- Va a `platform_settings`, la tabla singleton (id=1) que ya usa el super admin
-- para comisión / fee de MP / ventana de reembolso (migración 056,
-- `/super-admin/settings`), en vez de crear una tabla nueva o sumarlo a
-- `vertical_settings` (migración 078). Motivo: el pedido del CEO fue "en
-- super admin", sin mención de por vertical, y hoy Healthier opera con UN
-- profesional en el pool de Clínica — una perilla por vertical es
-- complejidad que nadie pidió todavía para este estadio del producto (mismo
-- criterio "Uber con 3 conductores" documentado en el CLAUDE.md del
-- monorepo). `platform_settings` ya tiene el patrón completo armado
-- (RLS de lectura para cualquier usuario autenticado, escritura sólo
-- super_admin, trigger de `updated_at`, service `paymentsService` con
-- get/updatePlatformSettings genéricos) — sumar una columna acá es lo que
-- menos código tira a la basura. Si en el futuro cada vertical necesita su
-- propia duración (una sesión de psicología de 50' no es una consulta
-- clínica de 15'), este mismo valor puede migrar a `vertical_settings` sin
-- romper nada: `ReservarConsulta.jsx` ya conoce la vertical seleccionada en
-- el momento en que arma la grilla.
--
-- ── Validación ────────────────────────────────────────────────────────────
-- Selector de opciones fijas (10/15/20/30/45/60), no un número libre: una
-- duración como 7 minutos no entra parejo en una franja horaria típica
-- ("09:00–13:00") y deja un resto suelto al final de la franja que la grilla
-- de `buildTimeSlots` ya descarta silenciosamente (corta el loop si el slot
-- no entra completo) — mejor no ofrecer esa duración que ofrecerla y que se
-- coma minutos de la agenda sin avisar. El CHECK espeja esas mismas opciones
-- en el <select> del super admin.
--
-- ── Turnos ya reservados ──────────────────────────────────────────────────
-- Este valor sólo alimenta la grilla que se le muestra al paciente en el
-- momento de reservar (qué horarios ofrecer). Los turnos que ya existen en
-- `consultations` guardan su propio `scheduled_at` (un timestamp fijo) y no
-- tienen una columna de duración que dependa de esto — cambiar la duración
-- del slot no mueve ni recalcula ningún turno ya reservado, sólo cambia la
-- grilla que se ofrece de ahí en adelante.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS slot_duration_minutes int NOT NULL DEFAULT 15;

ALTER TABLE public.platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_slot_duration_minutes_check;

ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_slot_duration_minutes_check
  CHECK (slot_duration_minutes IN (10, 15, 20, 30, 45, 60));

COMMENT ON COLUMN public.platform_settings.slot_duration_minutes IS
  'Duración en minutos de cada slot de turno ofrecido al paciente en /paciente/reservar. Editable desde /super-admin/settings. Default 15 = comportamiento histórico (Nacho Arteaga, 2026-07-08). No afecta turnos ya reservados, sólo la grilla que se arma de ahí en adelante.';
