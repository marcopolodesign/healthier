-- Auditoría de "iniciar sesión como" desde el super admin (impersonate-user
-- Edge Function). Sólo la función escribe acá (usa el service role, que
-- bypassea RLS) — no hay policy de insert para clientes normales, a
-- propósito: este log tiene que ser confiable incluso si alguien encontrara
-- la forma de llamar la función sin pasar por la UI.
create table public.impersonation_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id),
  admin_email text not null,
  target_user_id uuid references public.profiles(id),
  target_email text not null,
  created_at timestamptz not null default now()
);

alter table public.impersonation_log enable row level security;

create policy "super_admin ve el log de impersonación"
  on public.impersonation_log for select
  using (public.get_my_role() = 'super_admin');
