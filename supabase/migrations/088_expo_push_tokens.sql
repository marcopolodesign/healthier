-- Tokens de push de Expo (app mobile). Conviven con `push_subscriptions`
-- (web push VAPID): la Edge Function send-push-notification manda a ambos.
-- Un usuario puede tener varios devices; unicidad por token.

create table if not exists expo_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  token text not null,
  platform text,           -- 'ios' | 'android'
  device_name text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (token)
);

create index if not exists expo_push_tokens_user_idx on expo_push_tokens (user_id);

alter table expo_push_tokens enable row level security;

create policy "users manage own expo push tokens"
  on expo_push_tokens for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "service role reads all expo push tokens"
  on expo_push_tokens for select
  to service_role
  using (true);
