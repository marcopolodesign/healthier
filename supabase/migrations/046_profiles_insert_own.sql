-- profiles has RLS enabled with SELECT/UPDATE "own row" policies but no INSERT policy,
-- so every signup (authService.register) fails with 42501 "new row violates row-level
-- security policy for table profiles" right after supabase.auth.signUp().
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
