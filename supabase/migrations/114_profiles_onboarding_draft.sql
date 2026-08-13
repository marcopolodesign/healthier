-- Antes de esto, el wizard de onboarding profesional no guardaba NADA del
-- formulario hasta el envío final — sólo `onboarding_step` (el número de
-- paso). Un prospecto que llegaba a "Documentos" y se frenaba tenía
-- especialidad y matrícula ya tipeadas en pantalla, pero cero rastro en la
-- base: se perdía si cerraba la pestaña, y el super admin no podía verlo.
-- `onboarding_draft` guarda un snapshot del form en cada "Siguiente" (ver
-- Onboarding.jsx / trackStep) — sirve para mostrar en el sidecart de
-- Prospectos y para que el wizard restaure el progreso si vuelven.
alter table public.profiles add column onboarding_draft jsonb;
