-- Patient general health profile fields (step 2 of patient onboarding)
alter table public.profiles
  add column if not exists gender     text check (gender in ('masculino','femenino','no_binario','prefiero_no_decir')),
  add column if not exists height_cm  integer check (height_cm > 0 and height_cm < 300),
  add column if not exists weight_kg  numeric(5,1) check (weight_kg > 0 and weight_kg < 700),
  add column if not exists allergies  text;
