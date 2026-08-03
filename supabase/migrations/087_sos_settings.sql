-- ─────────────────────────────────────────────────────────────────────────────
-- Precio y disponibilidad de S.O.S. configurables desde /super-admin/verticales.
--
-- Hasta ahora `SOS_PRICE` vivía hardcodeado en emergencyService.js (comentario:
-- "mover a vertical_settings cuando haya un lugar real en Settings"). Ese día es
-- hoy — regla de Mateo (2026-08-03): todo lo que es política comercial/operativa
-- (precio, on/off) tiene que poder tocarse sin deploy, igual que ya pasa con las
-- 7 verticales clínicas de la migración 078.
--
-- ── Por qué reusar `vertical_settings` en vez de una tabla nueva ─────────────
-- La fila 'sos' NO es una vertical clínica — no tiene especialidad, no aparece
-- en ningún selector de especialidad ni en la grilla de verticales que ve el
-- paciente, y no participa del merge de `useVerticales()`/`src/lib/verticals.js`
-- (ese merge itera sobre el array `VERTICALS` del código, que no incluye 'sos';
-- ver `src/hooks/useVerticales.js` función `mezclar()`). Es sólo la config de un
-- servicio distinto (emergencias) que necesita exactamente la misma forma:
-- habilitado sí/no + precio. Reusar la tabla evita duplicar columnas, el CHECK
-- de precio, el trigger de `updated_at` y la RLS de "sólo super_admin escribe" —
-- y le da a esta fila la misma UI de super-admin (toggle + precio) gratis.
--
-- Consecuencia a tener en cuenta: cualquier código que lea `vertical_settings`
-- directamente (sin pasar por `verticalsService`/`useVerticales`) y la muestre
-- en una lista de verticales al paciente tiene que excluir explícitamente el id
-- 'sos'. Al momento de este migration, el único consumidor que itera la tabla
-- directamente es `verticalsService.getAll()` (sin filtro — devuelve las 8
-- filas), y sólo dos lugares consumen ese resultado: el hook `useVerticales()`
-- (filtra implícitamente porque itera sobre `VERTICALS`, no sobre la config) y
-- `/super-admin/verticales` (ídem: itera `VERTICALS`, no `config`, para la
-- sección de verticales — la fila 'sos' se renderiza aparte, a mano, en su
-- propia sección "Servicio de emergencias").
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.vertical_settings (id, enabled, ondemand_price, sort_order) VALUES
  ('sos', true, 50, 99)
ON CONFLICT (id) DO NOTHING;
