-- Track whether a reminder push notification has been sent for each consultation.
-- The appointment-reminders Edge Function sets this to true after sending, preventing double-sends.
alter table consultations add column if not exists reminder_sent boolean not null default false;

-- Index for efficient querying of unsent reminders in the upcoming window.
create index if not exists idx_consultations_reminder
  on consultations (status, scheduled_at, reminder_sent)
  where status = 'confirmed' and reminder_sent = false;
