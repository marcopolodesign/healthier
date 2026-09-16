-- El registro de las subidas de documentos del legajo: las que entraron y las
-- que rebotaron, con el motivo y el tamaño.
--
-- ── Por qué existe ──────────────────────────────────────────────────────────
-- El 2026-09-16 Mateo preguntó algo que no se podía contestar: **cuántos
-- profesionales suben un archivo y se lo rebotamos**. Lo único que había eran
-- los logs de Storage, con dos agujeros:
--
--   1. **Duran pocos días.** La ventana consultable no llega a una semana.
--   2. **No dicen por qué.** Un archivo demasiado grande y uno que el teléfono
--      no pudo leer dan los dos un **HTTP 400** — el 413 real viene escondido
--      en el cuerpo de la respuesta, que el log no guarda (ver
--      `src/lib/subidaConProgreso.js`).
--
-- Y sobre todo: los rechazos que atajamos en el browser —el archivo vacío, el
-- ilegible, el que pasa los 10 MB— **no llegan a la red**, así que no existe
-- ningún log de ellos en ningún lado. Ese es justo el caso que dejó a Andrea
-- Romina Garay con 32 intentos fallidos el 13/9 y sin volver nunca más.
--
-- Se guardan también las subidas que SÍ entraron, porque sin denominador el
-- número de rechazos no dice nada: lo que importa es qué proporción rebota.
--
-- ── Qué NO se guarda ────────────────────────────────────────────────────────
-- Nada del contenido del archivo. Sólo qué casillero del legajo era, cuánto
-- pesaba, de qué tipo y qué pasó. Es un dato operativo, no un dato de salud.
create table if not exists public.upload_log (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.profiles(id) on delete cascade,
  -- El casillero del legajo: titulo, matricula, dni, seguro_mala_praxis,
  -- certificado_especialista, cuit, avatar.
  documento   text not null,
  bucket      text not null,
  estado      text not null check (estado in ('ok', 'rechazado')),
  -- Por qué rebotó, en una palabra, para poder agrupar: 'muy_grande',
  -- 'vacio', 'ilegible', 'formato', 'sesion', 'red', 'otro'. NULL si entró.
  motivo      text check (motivo in ('muy_grande', 'vacio', 'ilegible', 'formato', 'sesion', 'red', 'otro')),
  -- El texto que efectivamente leyó la persona. Sirve para descubrir motivos
  -- nuevos que hoy caen en 'otro'.
  detalle     text,
  bytes       bigint,
  mime        text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_upload_log_created_at on public.upload_log(created_at desc);
create index if not exists idx_upload_log_estado     on public.upload_log(estado);
create index if not exists idx_upload_log_motivo     on public.upload_log(motivo);
create index if not exists idx_upload_log_usuario    on public.upload_log(usuario_id);

alter table public.upload_log enable row level security;

-- 🔴 Acá escribe **el browser**, no una Edge Function: la mitad de los rechazos
-- que interesan se atajan antes de tocar la red, así que no hay ningún servidor
-- que se entere. Por eso, a diferencia de `email_log`, hay policy de insert —
-- y cada uno sólo puede escribir filas a su propio nombre.
drop policy if exists upload_log_insert_propio on public.upload_log;
create policy upload_log_insert_propio on public.upload_log
  for insert to authenticated
  with check (usuario_id = auth.uid());

-- Leer, sólo el equipo interno. `get_my_role()` es SECURITY DEFINER a propósito
-- (ver la invariante de RLS en CLAUDE.md): una policy que consulte `profiles`
-- directo entra en recursión.
drop policy if exists upload_log_admin_read on public.upload_log;
create policy upload_log_admin_read on public.upload_log
  for select to authenticated
  using (public.get_my_role() in ('admin', 'super_admin'));

comment on table public.upload_log is
  'Una fila por intento de subir un documento del legajo, entrara o no. Lo escribe el browser (ver src/services/uploadLogService.js) porque los rechazos de tamaño/archivo ilegible nunca llegan al servidor.';
