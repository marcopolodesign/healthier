-- ─────────────────────────────────────────────────────────────────────────────
-- `diff_de_campos` (132) trataba `null` y `''` como valores distintos.
--
-- Salió de probar el flujo real en staging, no de leer el código: al cambiar la
-- especialidad, `/profesional/perfil` limpia la sub-especialidad poniéndola en
-- `''`, mientras que en la base estaba en `null`. El diff registraba entonces
-- **dos** cambios y el super admin veía "Sub-especialidad: vacío → vacío" al
-- lado del cambio de verdad.
--
-- Peor que el ruido: cualquier formulario que mande `''` donde había `null`
-- —cosa que hacen todos los `<input>` vacíos de React— mandaría a re-verificar
-- a un profesional que no cambió nada.
--
-- "Sin dato" es un solo estado, aunque la base lo pueda escribir de dos formas.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.diff_de_campos(
  antes jsonb, ahora jsonb, campos text[]
)
returns jsonb
language plpgsql
immutable
as $$
declare
  campo   text;
  v_antes jsonb;
  v_ahora jsonb;
  cambios jsonb := '[]'::jsonb;
begin
  foreach campo in array campos loop
    -- `'""'::jsonb` es la cadena vacía en JSON: se normaliza a null para que
    -- "sin dato" sea un solo valor.
    v_antes := nullif(antes -> campo, '""'::jsonb);
    v_ahora := nullif(ahora -> campo, '""'::jsonb);
    -- `jsonb null` (la ausencia) y `'null'::jsonb` (el null de JSON, que es lo
    -- que devuelve `to_jsonb(fila)` para una columna en NULL) también son el
    -- mismo estado a estos efectos.
    if v_antes = 'null'::jsonb then v_antes := null; end if;
    if v_ahora = 'null'::jsonb then v_ahora := null; end if;

    if v_antes is distinct from v_ahora then
      cambios := cambios || jsonb_build_object(
        'campo', campo,
        'antes', antes -> campo,
        'ahora', ahora -> campo
      );
    end if;
  end loop;
  if jsonb_array_length(cambios) = 0 then
    return null;
  end if;
  return cambios;
end;
$$;
