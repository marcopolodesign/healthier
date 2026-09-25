-- ============================================================
-- 176 — El profesional verificado sin precio no aparece en la búsqueda
-- ============================================================
-- Regla de Mateo (2026-09-25): en producción hay profesionales verificados y
-- activos con `price_video`, `price_presencial` Y `session_price` los tres en
-- `null` (hoy 4: Pogonza, Weyermann, Oviedo, Zaidman) — no se les puede
-- reservar turno y en la app aparecen a "$0". `null` sigue siendo un estado
-- válido ("todavía no lo cargó", migración 142, piso $15.000 en
-- `website/src/lib/tarifas.js`); lo que cambia es que mientras estén así, no
-- se los ofrece al paciente.
--
-- Se decidió: ocultarlos de la búsqueda hasta que carguen precio + avisarles
-- por mail y en su Dashboard + mostrárselo al super admin al verificar.
--
-- Esta migración es la mitad de base de esa decisión:
--   1. Redefine `buscar_profesionales_cobrables` (migración 079 — es la única
--      definición real; el resto de la búsqueda del paciente se filtra del
--      lado de `professionalService.js`, no acá) agregando la condición de
--      precio.
--   2. Un trigger que, cuando `is_verified` pasa de false a true y no hay
--      ningún precio cargado, dispara el mail `precio-pendiente` (patrón de
--      la 146/148: `enviar_mail()` + acotado a `after update of is_verified`).
--      Sin columna `mail_*_enviado_at` nueva — desde la 148 el freno contra
--      reenvío es `email_log`, que es el que dice la verdad.
-- ============================================================

-- ── 1 · buscar_profesionales_cobrables — agrega el piso de precio ──────────
create or replace function public.buscar_profesionales_cobrables(
  p_texto          text     DEFAULT NULL,
  p_especialidades text[]   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
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
      -- Si no tiene NINGÚN precio cargado, tampoco: no se le puede reservar
      -- turno aunque tenga Mercado Pago conectado. Piso $15.000, igual que
      -- `validar_piso_precio_consulta` (migración 142) y `cumplePrecioMinimo`
      -- (website/src/lib/tarifas.js) — si el número cambia, cambia en los tres.
      AND (
        (pp.price_video      IS NOT NULL AND pp.price_video      >= 15000)
        OR (pp.price_presencial IS NOT NULL AND pp.price_presencial >= 15000)
        OR (pp.session_price    IS NOT NULL AND pp.session_price    >= 15000)
      )
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
  'Profesionales verificados, activos, con Mercado Pago conectado Y con al menos un precio cargado (mínimo $15.000, migración 176). Busca por nombre sin distinguir acentos ni mayúsculas. SECURITY INVOKER: respeta las RLS de quien llama.';

REVOKE ALL ON FUNCTION public.buscar_profesionales_cobrables(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_profesionales_cobrables(text, text[]) TO anon, authenticated;

-- ── 2 · Aviso por mail cuando se verifica sin precio cargado ───────────────
create or replace function public.avisar_falta_precio_por_mail()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Sólo en la transición false → true: si ya estaba verificado (p.ej. un
  -- admin corrige otro campo) esto no tiene que volver a dispararse.
  if new.is_verified and not coalesce(old.is_verified, false) then
    if not (
      (new.price_video      is not null and new.price_video      >= 15000)
      or (new.price_presencial is not null and new.price_presencial >= 15000)
      or (new.session_price    is not null and new.session_price    >= 15000)
    ) then
      -- Sin columna `mail_*_enviado_at` (regla de la 148): el freno contra
      -- reenvío es `email_log`, que registra el resultado real de Resend.
      if not exists (
        select 1 from public.email_log
         where tipo = 'precio-pendiente'
           and usuario_id = new.user_id
           and estado = 'enviado'
      ) then
        perform public.enviar_mail(jsonb_build_object('tipo', 'precio-pendiente', 'userId', new.user_id));
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.avisar_falta_precio_por_mail() is
  'Cuando un profesional pasa a verificado sin ningún precio cargado, dispara el mail "precio-pendiente" (send-email). No manda dos veces: se frena contra email_log, no contra una columna nueva (regla de la 148).';

drop trigger if exists professional_profiles_mail_falta_precio on public.professional_profiles;
create trigger professional_profiles_mail_falta_precio
  after update of is_verified on public.professional_profiles
  for each row execute function public.avisar_falta_precio_por_mail();
