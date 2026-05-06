-- Add vertical column to consultations so video consultations
-- can record the specialty/service type from the booking flow.
alter table public.consultations
  add column if not exists vertical text;
