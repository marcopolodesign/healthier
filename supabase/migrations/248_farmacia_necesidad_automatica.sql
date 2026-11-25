-- 248 · Farmacia: la necesidad se asigna sola y la farmacia la revisa (2026-11-25)
--
-- Mateo: "lo hacemos nosotros y que lo chequeen". Hasta acá la necesidad de
-- cada producto (migración 246) la repartía un script con una lista de
-- marcas hardcodeada; un producto que entraba después por Excel quedaba sin
-- necesidad hasta que alguien volviera a correrlo.
--
-- Ahora la regla vive acá, en un solo lugar:
--   · `farmacia_necesidad_reglas`: prefijo del nombre (minúsculas) → necesidad,
--     con la droga anotada. Es la MISMA lista que tenía el script, armada a
--     mano con el vademécum del servicio de recetas (2026-11-22). Lo dudoso no
--     está a propósito: queda sin necesidad y aparece sólo en su categoría.
--   · `farmacia_necesidad_sugerida(nombre)`: la necesidad que da la regla.
--   · Un trigger completa la necesidad al DAR DE ALTA un producto que no la
--     trae, y la marca `necesidad_origen = 'auto'` (a revisar).
--   · `farmacia_asignar_necesidades()`: lo mismo en bloque, para el catálogo
--     que ya existe. Lo llama `scripts/farmacia-necesidades.mjs`.
--
-- Por qué no se consulta el vademécum en el momento del alta: el criterio
-- nunca lo hizo (la droga de cada marca se averiguó una vez y quedó en la
-- lista), y llamarlo desde la base exigiría la clave del servicio de recetas
-- y red en cada INSERT. Una marca nueva que no está en la lista queda sin
-- necesidad —el mismo resultado que "dudoso"—, la farmacia se la puede
-- elegir a mano, y se suma una fila acá para las próximas.
--
-- `necesidad_origen`:
--   'auto'     = la puso la regla; la farmacia todavía no la revisó.
--   'farmacia' = la eligió o confirmó la farmacia. La regla NUNCA la pisa.
--   NULL       = nadie la tocó (y la regla no tenía nada para decir).

CREATE TABLE IF NOT EXISTS public.farmacia_necesidad_reglas (
  prefijo    text PRIMARY KEY CHECK (prefijo = lower(prefijo) AND btrim(prefijo) <> ''),
  necesidad  text NOT NULL CHECK (necesidad IN ('dolor', 'resfrio', 'piel', 'presion', 'digestion', 'antibioticos')),
  droga      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.farmacia_necesidad_reglas IS
  'Prefijo del nombre del producto (minúsculas) → necesidad del mosaico del paciente. La usan el trigger de alta y farmacia_asignar_necesidades(). Sólo marcas obvias; lo dudoso no va.';

ALTER TABLE public.farmacia_necesidad_reglas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS farmacia_necesidad_reglas_leer ON public.farmacia_necesidad_reglas;
CREATE POLICY farmacia_necesidad_reglas_leer ON public.farmacia_necesidad_reglas
  FOR SELECT TO authenticated USING (true);
-- Escribir: sólo con la service role (migración o script).

INSERT INTO public.farmacia_necesidad_reglas (prefijo, necesidad, droga) VALUES
  ('diastone', 'dolor', 'diclofenac (+pridinol / +B12)'),
  ('sindol', 'dolor', 'ibuprofeno (Sindol, Sindolito)'),
  ('kemanat', 'dolor', 'ketorolac'),
  ('mell ', 'dolor', 'meloxicam'),
  ('cracox', 'dolor', 'etoricoxib'),
  ('solacil', 'dolor', 'ergotamina + cafeína (migraña)'),
  ('ibuprofeno', 'dolor', 'ibuprofeno'),
  ('paracetamol', 'dolor', 'paracetamol'),
  ('coris grip', 'resfrio', 'paracetamol + pseudoefedrina'),
  ('alergiano', 'resfrio', 'loratadina'),
  ('teralmina', 'resfrio', 'desloratadina'),
  ('rhinal', 'resfrio', 'nafazolina (gotas nasales)'),
  ('funciobron', 'resfrio', 'bromhexina / hedera helix'),
  ('loratadina', 'resfrio', 'loratadina'),
  ('suero fisiológico nasal', 'resfrio', 'cloruro de sodio'),
  ('perlivit', 'piel', 'dermocosmética: protector, micelar, sérum'),
  ('medifungol', 'piel', 'clotrimazol / terbinafina'),
  ('dioxis', 'piel', 'aciclovir crema'),
  ('triplex', 'piel', 'betametasona + gentamicina + miconazol'),
  ('mosqut', 'piel', 'repelente'),
  ('protector solar', 'piel', NULL),
  ('atenolol', 'presion', 'atenolol'),
  ('sulocten', 'presion', 'enalapril (+HCTZ)'),
  ('enromic', 'presion', 'losartán (+HCTZ)'),
  ('entarsol', 'presion', 'carvedilol'),
  ('semanar', 'presion', 'valsartán'),
  ('anexa', 'presion', 'amlodipina'),
  ('redugluc', 'presion', 'metformina'),
  ('lomet', 'presion', 'glimepirida'),
  ('oblisec', 'digestion', 'omeprazol'),
  ('pampar', 'digestion', 'pantoprazol'),
  ('relasules', 'digestion', 'esomeprazol'),
  ('custey', 'digestion', 'loperamida'),
  ('rilaquin', 'digestion', 'metoclopramida'),
  ('relopat', 'digestion', 'trimebutina'),
  ('omeprazol', 'digestion', 'omeprazol'),
  ('nobactam', 'antibioticos', 'amoxicilina (+clavulánico)'),
  ('microsulf', 'antibioticos', 'ciprofloxacina'),
  ('sinurit', 'antibioticos', 'cefalexina'),
  ('tanezox', 'antibioticos', 'azitromicina'),
  ('finasept', 'antibioticos', 'claritromicina'),
  ('ely diar', 'antibioticos', 'levofloxacina (no es un antidiarreico)'),
  ('amoxicilina', 'antibioticos', 'amoxicilina')
ON CONFLICT (prefijo) DO NOTHING;

ALTER TABLE public.pharmacy_products
  ADD COLUMN IF NOT EXISTS necesidad_origen text;
ALTER TABLE public.pharmacy_products
  DROP CONSTRAINT IF EXISTS pharmacy_products_necesidad_origen_check;
ALTER TABLE public.pharmacy_products
  ADD CONSTRAINT pharmacy_products_necesidad_origen_check
  CHECK (necesidad_origen IS NULL OR necesidad_origen IN ('auto', 'farmacia'));
COMMENT ON COLUMN public.pharmacy_products.necesidad_origen IS
  'auto = la necesidad la puso la regla (a revisar por la farmacia) · farmacia = la eligió o confirmó la farmacia (la regla nunca la pisa) · NULL = nadie la tocó.';
CREATE INDEX IF NOT EXISTS idx_pharmacy_products_necesidad_a_revisar
  ON public.pharmacy_products(pharmacy_id) WHERE necesidad_origen = 'auto';

-- La necesidad que da la regla para un nombre: el prefijo más largo que calce.
CREATE OR REPLACE FUNCTION public.farmacia_necesidad_sugerida(p_nombre text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.necesidad
  FROM public.farmacia_necesidad_reglas r
  WHERE starts_with(lower(btrim(coalesce(p_nombre, ''))), r.prefijo)
  ORDER BY length(r.prefijo) DESC
  LIMIT 1
$$;

-- El trigger. En el alta completa lo que falta; en un cambio, cualquier
-- necesidad que se toque a mano pasa a ser de la farmacia. La asignación en
-- bloque se avisa con `farmacia.necesidad_auto` para no quedar como manual.
CREATE OR REPLACE FUNCTION public.farmacia_necesidad_al_guardar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('farmacia.necesidad_auto', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.necesidad IS NOT NULL THEN
      -- La trajo el alta (columna "Necesidad" del Excel): es de la farmacia.
      NEW.necesidad_origen := coalesce(NEW.necesidad_origen, 'farmacia');
    ELSIF NEW.necesidad_origen IS NULL THEN
      NEW.necesidad := public.farmacia_necesidad_sugerida(NEW.name);
      IF NEW.necesidad IS NOT NULL THEN
        NEW.necesidad_origen := 'auto';
      END IF;
    END IF;
  ELSIF NEW.necesidad IS DISTINCT FROM OLD.necesidad
        AND NEW.necesidad_origen IS NOT DISTINCT FROM OLD.necesidad_origen THEN
    NEW.necesidad_origen := 'farmacia';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_farmacia_necesidad_al_guardar ON public.pharmacy_products;
CREATE TRIGGER trg_farmacia_necesidad_al_guardar
  BEFORE INSERT OR UPDATE OF necesidad, necesidad_origen ON public.pharmacy_products
  FOR EACH ROW EXECUTE FUNCTION public.farmacia_necesidad_al_guardar();

-- En bloque, para el catálogo que ya existe. Nunca toca lo de la farmacia.
-- `p_forzar` además corrige lo 'auto' que la regla hoy diría distinto.
CREATE OR REPLACE FUNCTION public.farmacia_asignar_necesidades(p_forzar boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  PERFORM set_config('farmacia.necesidad_auto', 'on', true);
  UPDATE public.pharmacy_products p
     SET necesidad = s.sugerida, necesidad_origen = 'auto'
    FROM (SELECT id, public.farmacia_necesidad_sugerida(name) AS sugerida FROM public.pharmacy_products) s
   WHERE s.id = p.id
     AND s.sugerida IS NOT NULL
     AND p.necesidad_origen IS DISTINCT FROM 'farmacia'
     AND (p.necesidad IS NULL OR (p_forzar AND p.necesidad IS DISTINCT FROM s.sugerida));
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('farmacia.necesidad_auto', 'off', true);
  RETURN n;
END
$$;

REVOKE ALL ON FUNCTION public.farmacia_asignar_necesidades(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.farmacia_asignar_necesidades(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.farmacia_necesidad_sugerida(text) TO authenticated, service_role;

-- Lo que ya repartió el script (migración 246) queda a revisar: nadie de la
-- farmacia lo eligió todavía.
UPDATE public.pharmacy_products
   SET necesidad_origen = 'auto'
 WHERE necesidad IS NOT NULL AND necesidad_origen IS NULL;
