-- Track day-before reminder separately so patients get both a 24h and a 30-min notification.
alter table consultations add column if not exists reminder_24h_sent boolean not null default false;

-- Reset both reminder flags when a consultation is rescheduled (scheduled_at changes)
-- so the patient receives fresh reminders for the new time.
create or replace function reset_reminder_on_reschedule()
returns trigger language plpgsql as $$
begin
  if new.scheduled_at is distinct from old.scheduled_at then
    new.reminder_sent     := false;
    new.reminder_24h_sent := false;
  end if;
  return new;
end;
$$;

create trigger trg_reset_reminder_on_reschedule
  before update on consultations
  for each row
  when (old.scheduled_at is distinct from new.scheduled_at)
  execute function reset_reminder_on_reschedule();
