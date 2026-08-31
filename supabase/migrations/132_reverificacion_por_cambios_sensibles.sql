-- ─────────────────────────────────────────────────────────────────────────────
-- Re-verificación cuando el profesional cambia un dato sensible del legajo.
--
-- Pedido del CEO (2026-08-31): "que el profesional NO pueda cambiar su vertical
-- una vez que se verificó ni cuando envió los datos. Si lo quiere cambiar, que
-- se le avise que va a tener que ser revisado de nuevo y que va a pasar a estar
-- como 'pendiente de verificación' una vez más — esto debería pasar con todos
-- los cambios sensibles del profesional."
--
-- El agujero: el super admin aprueba a alguien mirando SU especialidad, SU
-- matrícula y SUS documentos. Una vez aprobado, `/profesional/perfil` le deja
-- cambiar la especialidad con un `<select>` y guardar — y sigue verificado, ya
-- listado como psicólogo cuando lo que se revisó fue un título de clínica. La
-- verificación queda hablando de datos que ya no existen.
--
-- Qué se decidió (Mateo, 2026-08-31), y por qué es esto y no otra cosa:
--
--  · **Alcance = legajo + identidad.** Especialidad, sub-especialidad,
--    matrícula (tipo y número), los seis documentos, el CUIT, y en `profiles`
--    el nombre completo y el DNI. Todo lo que el super admin efectivamente
--    mira para decidir. La bio, la foto, la dirección, las tarifas y los
--    horarios NO son sensibles: no forman parte de lo que se aprueba.
--
--  · **El cambio se aplica y el perfil vuelve a pendiente**, en vez de quedar
--    en una cola de "cambios propuestos" que sólo se aplican al aprobarse. Es
--    el mismo camino que ya recorre un reenvío de onboarding, no hay tabla ni
--    pantalla nuevas, y el estado del profesional sigue siendo una sola fila —
--    que es lo que hace que `search`, el pool y las policies no necesiten
--    aprender nada nuevo.
--
--  · **Sigue activo (`is_active` no se toca).** Baja `is_verified`, así que
--    desaparece de la búsqueda, del pool de on-demand y de
--    `buscar_profesionales_cobrables` — no le entra nadie nuevo. Pero los
--    turnos ya agendados y cobrados los sigue atendiendo: cancelarlos sería
--    castigar al paciente por un trámite del profesional.
--
--  · **Se registra QUÉ cambió** (`reverification_changes`), no sólo que algo
--    cambió. Sin eso el super admin ve un verificado que volvió a pendiente y
--    tiene que adivinar qué mirar. Mismo criterio que la 097 con el historial
--    de revisiones.
--
-- La regla vive en la base, no en la UI. El aviso de `/profesional/perfil` es
-- cortesía; el trigger es lo que la hace cierta para cualquier camino que
-- exista hoy o se agregue mañana (otra pantalla, la app, un script).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Estado de re-verificación ───────────────────────────────────────────
-- Hace falta una marca propia y no alcanza con `is_verified = false`: el
-- Dashboard del profesional decide con eso qué pantalla mostrar, y a alguien
-- que ya fue verificado y sigue atendiendo su agenda no se le puede mostrar
-- "Completá tu perfil" ni "Perfil en revisión (24-48 hs)" como si fuera un
-- alta nueva.
alter table public.professional_profiles
  add column if not exists reverification_pending boolean not null default false,
  add column if not exists reverification_requested_at timestamptz,
  add column if not exists reverification_changes jsonb;

comment on column public.professional_profiles.reverification_pending is
  'true = el profesional YA estaba verificado (o ya estaba en re-verificación) y cambió un dato sensible del legajo. Baja is_verified pero NO is_active: no recibe consultas nuevas y sigue atendiendo las ya agendadas.';
comment on column public.professional_profiles.reverification_changes is
  'Qué cambió, para que el super admin sepa dónde mirar: [{"campo": "specialty", "antes": "medicina_general", "ahora": "psicologia"}]. Se acumula si hay varios cambios antes de que lo revisen.';

create index if not exists idx_pp_reverification_pending
  on public.professional_profiles (reverification_pending)
  where reverification_pending;

-- ── 1b. Quién puede saltearse estas reglas ─────────────────────────────────
-- Los tres triggers de abajo dejan pasar al mismo conjunto de actores, así que
-- la definición vive en un solo lugar.
--
--  · **admin / super_admin** — son justamente quienes corrigen un legajo y
--    aprueban. Si su propia corrección mandara el perfil a pendiente, aprobar
--    sería imposible: cada arreglo desharía la aprobación.
--  · **service_role** — los seeds, los scripts de verificación y las Edge
--    Functions escriben sin sesión de usuario (`auth.uid()` es null, así que
--    `get_my_role()` devuelve null). Sin esta rama, `seed-staging.mjs` y
--    `seed-cuentas-cliente.mjs` no pueden dejar un profesional verificado.
create or replace function public.es_operador_de_plataforma()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(public.get_my_role() in ('admin', 'super_admin'), false)
      or coalesce(auth.role(), current_user) = 'service_role';
$$;

comment on function public.es_operador_de_plataforma() is
  'true para admin/super_admin y para el service_role (seeds, scripts y Edge Functions, que escriben sin sesión de usuario). Usada por los triggers de re-verificación para saber a quién NO se le aplican.';

-- ── 2. Qué columnas son sensibles ──────────────────────────────────────────
-- En una función y no repetidas en cada trigger: los dos triggers de abajo y
-- cualquier chequeo futuro leen la misma lista, así que agregar un documento
-- nuevo al legajo es tocar un solo lugar.
create or replace function public.columnas_sensibles_del_profesional()
returns text[]
language sql
immutable
as $$
  select array[
    'specialty',
    'sub_specialty',
    'license_type',
    'license_number',
    'title_document_url',
    'license_document_url',
    'dni_document_url',
    'malpractice_insurance_document_url',
    'specialist_certificate_document_url',
    'cuit_document_url',
    'cuit_number'
  ];
$$;

-- Diff entre dos versiones de una fila, restringido a un conjunto de columnas.
-- Devuelve `null` si no cambió ninguna — así el que llama pregunta una sola vez.
create or replace function public.diff_de_campos(
  antes jsonb, ahora jsonb, campos text[]
)
returns jsonb
language plpgsql
immutable
as $$
declare
  campo   text;
  cambios jsonb := '[]'::jsonb;
begin
  foreach campo in array campos loop
    if (antes -> campo) is distinct from (ahora -> campo) then
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

-- ── 3. El trigger sobre el legajo ──────────────────────────────────────────
create or replace function public.marcar_reverificacion_del_profesional()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cambios jsonb;
begin
  if public.es_operador_de_plataforma() then
    return new;
  end if;

  cambios := public.diff_de_campos(
    to_jsonb(old), to_jsonb(new), public.columnas_sensibles_del_profesional()
  );
  if cambios is null then
    return new;
  end if;

  if old.is_verified or old.reverification_pending then
    -- Ya estaba aprobado (o ya venía de un cambio sin revisar): vuelve a la
    -- cola sin perder la agenda.
    new.is_verified                 := false;
    new.reverification_pending      := true;
    new.reverification_requested_at := now();
    -- Se acumula con lo que ya hubiera pendiente: si cambia la especialidad y
    -- después la matrícula antes de que lo revisen, el super admin tiene que
    -- ver las dos cosas, no sólo la última.
    new.reverification_changes      := coalesce(old.reverification_changes, '[]'::jsonb) || cambios;

  elsif old.submitted_at is not null then
    -- Todavía no lo aprobaron pero ya había mandado el legajo: la revisión
    -- arranca de nuevo con los datos nuevos, así que vuelve al final de la
    -- cola en vez de quedar con la fecha de envío vieja.
    new.submitted_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists professional_profiles_marcar_reverificacion on public.professional_profiles;
create trigger professional_profiles_marcar_reverificacion
  before update on public.professional_profiles
  for each row
  execute function public.marcar_reverificacion_del_profesional();

-- ── 4. El mismo criterio para nombre y DNI, que viven en `profiles` ────────
-- La identidad es parte de lo que se verifica: el DNI se coteja contra el
-- documento subido y el nombre contra el título y la matrícula. Que estén en
-- otra tabla es un detalle del esquema, no una excepción a la regla.
create or replace function public.marcar_reverificacion_por_identidad()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cambios jsonb;
begin
  if public.es_operador_de_plataforma() then
    return new;
  end if;
  if new.role is distinct from 'professional' then
    return new;
  end if;

  cambios := public.diff_de_campos(
    to_jsonb(old), to_jsonb(new), array['full_name', 'dni']
  );
  if cambios is null then
    return new;
  end if;

  update public.professional_profiles pp
     set is_verified                 = false,
         reverification_pending      = true,
         reverification_requested_at = now(),
         reverification_changes      = coalesce(pp.reverification_changes, '[]'::jsonb) || cambios
   where pp.user_id = new.id
     and (pp.is_verified or pp.reverification_pending);

  return new;
end;
$$;

drop trigger if exists profiles_marcar_reverificacion on public.profiles;
create trigger profiles_marcar_reverificacion
  after update on public.profiles
  for each row
  when (old.full_name is distinct from new.full_name or old.dni is distinct from new.dni)
  execute function public.marcar_reverificacion_por_identidad();

-- ── 5. Aprobar limpia la marca ─────────────────────────────────────────────
-- `professionalService.approve()` ya escribe `is_verified = true` desde el
-- browser del super admin y ahora también limpia estas tres columnas. Se deja
-- además un trigger que lo garantiza: si alguna vez alguien vuelve a poner
-- `is_verified = true` por otro camino, no puede quedar un perfil verificado
-- que la UI siga mostrando como "cambio sin revisar".
create or replace function public.limpiar_reverificacion_al_verificar()
returns trigger
language plpgsql
as $$
begin
  new.reverification_pending      := false;
  new.reverification_requested_at := null;
  new.reverification_changes      := null;
  return new;
end;
$$;

drop trigger if exists professional_profiles_limpiar_reverificacion on public.professional_profiles;
create trigger professional_profiles_limpiar_reverificacion
  before update on public.professional_profiles
  for each row
  when (new.is_verified and not old.is_verified)
  execute function public.limpiar_reverificacion_al_verificar();

-- ── 6. Nadie se verifica a sí mismo ────────────────────────────────────────
-- Sin esto todo lo de arriba es decorativo: `prof_profiles_owner_write` (001)
-- es una policy `for all` sobre la fila entera, así que hasta hoy el propio
-- profesional podía escribir `is_verified = true` en su legajo — y con este
-- cambio le alcanzaría con mandarlo en el mismo update que la especialidad
-- nueva para saltearse la re-verificación entera.
--
-- Es un agujero que ya existía (cualquiera con su sesión podía autoverificarse
-- y entrar al pool de pacientes), pero se cierra acá porque es exactamente la
-- puerta que esta migración necesita cerrada. Restringir columnas por policy
-- no se puede en Postgres; el trigger es la herramienta correcta.
--
-- Sólo se bloquea SUBIR el estado: bajarlo es legítimo y ya se hace — el
-- reenvío de onboarding manda `is_verified = false`, y este mismo archivo lo
-- baja al detectar un cambio sensible.
create or replace function public.bloquear_autoverificacion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.es_operador_de_plataforma() then
    return new;
  end if;
  raise exception 'Sólo un administrador de Healthier puede verificar un perfil profesional.'
    using errcode = '42501';
end;
$$;

drop trigger if exists professional_profiles_bloquear_autoverificacion on public.professional_profiles;
create trigger professional_profiles_bloquear_autoverificacion
  before update on public.professional_profiles
  for each row
  when (new.is_verified and not old.is_verified)
  execute function public.bloquear_autoverificacion();
