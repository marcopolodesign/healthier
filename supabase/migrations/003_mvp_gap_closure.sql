-- ============================================================
-- Healthier MVP — Gap closure pass
-- ============================================================

-- ── Geo columns for professional_profiles ────────────────────
alter table public.professional_profiles
  add column if not exists address   text,
  add column if not exists latitude  numeric(9,6),
  add column if not exists longitude numeric(9,6);

create index if not exists idx_prof_profiles_geo
  on public.professional_profiles(latitude, longitude)
  where is_verified = true and is_active = true;

-- ── Rejection tracking for professional_profiles ─────────────
alter table public.professional_profiles
  add column if not exists rejection_reason text,
  add column if not exists rejected_at      timestamptz;

-- ── Consultation enhancements ─────────────────────────────────
alter table public.consultations
  add column if not exists modality         text check (modality in ('video','presencial')),
  add column if not exists prescription_url text,
  add column if not exists cancelled_at     timestamptz,
  add column if not exists cancelled_by     uuid references public.profiles(id),
  add column if not exists cancel_reason    text;

-- ── Patient profile real columns ──────────────────────────────
alter table public.profiles
  add column if not exists address          text,
  add column if not exists blood_type       text,
  add column if not exists insurance_name   text,
  add column if not exists insurance_num    text,
  add column if not exists emergency_name   text,
  add column if not exists emergency_phone  text,
  add column if not exists emergency_rel    text;

-- ── Prescriptions storage bucket ─────────────────────────────
-- (create via Supabase dashboard or MCP if not already created)

-- ── Super-admin promote RPC ───────────────────────────────────
create or replace function public.promote_user_to_admin(
  target_email text,
  new_role     text default 'admin'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and role = 'super_admin'
  ) then
    raise exception 'only super_admin can promote';
  end if;
  if new_role not in ('admin','super_admin','professional','patient') then
    raise exception 'invalid role: %', new_role;
  end if;
  update profiles set role = new_role where lower(email) = lower(target_email);
end;
$$;

revoke all   on function public.promote_user_to_admin(text, text) from public;
grant execute on function public.promote_user_to_admin(text, text) to authenticated;

-- ── Backfill geo for demo professionals ──────────────────────
-- Coordinates spread across BA so they appear near the default
-- fallback centre (Av. Santa Fe 1234, Barrio Norte ≈ -34.5957, -58.3870)
update public.professional_profiles set
  address = 'Av. Santa Fe 1900, Recoleta, Buenos Aires',
  latitude = -34.5875, longitude = -58.3956
where user_id = '00000001-0000-0000-0000-000000000001';

update public.professional_profiles set
  address = 'Av. Santa Fe 3200, Palermo, Buenos Aires',
  latitude = -34.5765, longitude = -58.4124
where user_id = '00000002-0000-0000-0000-000000000002';

update public.professional_profiles set
  address = 'Av. Corrientes 4500, Villa Crespo, Buenos Aires',
  latitude = -34.5975, longitude = -58.4344
where user_id = '00000003-0000-0000-0000-000000000003';

update public.professional_profiles set
  address = 'Av. Cabildo 2800, Belgrano, Buenos Aires',
  latitude = -34.5612, longitude = -58.4556
where user_id = '00000004-0000-0000-0000-000000000004';

update public.professional_profiles set
  address = 'Av. Rivadavia 5800, Caballito, Buenos Aires',
  latitude = -34.6093, longitude = -58.4389
where user_id = '00000005-0000-0000-0000-000000000005';
