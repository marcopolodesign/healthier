-- ============================================================
-- 142 — Piso de $15.000 por consulta, para todos los profesionales
-- ============================================================
-- Regla de Mateo (2026-09-02): toda consulta de la app, presencial o por
-- videollamada, vale como mínimo $15.000. Vale para el precio base de cada
-- modalidad y también para cada "tipo de consulta" con precio propio, que es
-- el que termina cobrándose cuando el paciente elige uno.
--
-- El formulario (`Configuracion.jsx`) ya lo avisa y no deja guardar por debajo,
-- pero eso es explicación, no cumplimiento: `professional_profiles` y
-- `consultation_types` se pueden escribir con un PATCH directo a PostgREST —
-- la misma clase de agujero que la 136 y la 137 cerraron para los pagos. El
-- piso vive acá.
--
-- No es un CHECK sino un trigger a propósito: un CHECK sobre las filas
-- existentes obliga a decidir hoy qué hacer con las que ya están por debajo
-- (dos, con precios de prueba: $50/$40 y $1.000). Con el trigger esas filas
-- siguen ahí y sólo tienen que corregir el precio la próxima vez que alguien
-- las toque — que es exactamente cuando corresponde pedirlo. El checklist del
-- dashboard, mientras tanto, ya les marca "Precio de consulta" como pendiente.
--
-- `null` sigue siendo válido: es "todavía no lo cargó", distinto de "lo cargó
-- mal". Ese caso lo cubre el paso pendiente del checklist, no un error.
-- ============================================================

create or replace function public.validar_piso_precio_consulta()
returns trigger
language plpgsql
as $$
declare
  -- Si cambia, cambia también en website/src/lib/tarifas.js (formulario y
  -- checklist) y en el texto del mensaje de abajo.
  v_minimo constant numeric := 15000;
begin
  if tg_table_name = 'professional_profiles' then
    if (new.price_presencial is not null and new.price_presencial < v_minimo)
       or (new.price_video is not null and new.price_video < v_minimo)
       or (new.session_price is not null and new.session_price < v_minimo) then
      raise exception 'El precio mínimo por consulta es $15.000. Revisalo en Configuración > Tarifas.'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'consultation_types' then
    if new.price is not null and new.price < v_minimo then
      raise exception 'El precio mínimo por consulta es $15.000. Revisalo en Configuración > Tarifas.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validar_piso_precio_consulta() is
  'Piso de $15.000 por consulta (Mateo, 2026-09-02). Único lugar donde se hace cumplir; el número también está en website/src/lib/tarifas.js para el formulario y el checklist del profesional — si se cambia, se cambian los dos.';

drop trigger if exists professional_profiles_piso_precio on public.professional_profiles;
create trigger professional_profiles_piso_precio
  before insert or update of price_presencial, price_video, session_price
  on public.professional_profiles
  for each row
  execute function public.validar_piso_precio_consulta();

drop trigger if exists consultation_types_piso_precio on public.consultation_types;
create trigger consultation_types_piso_precio
  before insert or update of price
  on public.consultation_types
  for each row
  execute function public.validar_piso_precio_consulta();
