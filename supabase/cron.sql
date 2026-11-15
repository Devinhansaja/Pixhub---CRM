-- =====================================================================
-- OPTIONAL scheduled jobs (run once in the Supabase SQL Editor).
-- Requires: Database → Extensions → enable "pg_cron" and "pg_net".
-- Replace YOUR-PROJECT-REF and YOUR-CRON-SECRET (same value as the
-- CRON_SECRET edge-function secret). Not part of the migrations because
-- it contains a project-specific URL and secret.
-- =====================================================================

-- Reminders for tasks / follow-ups + quotation expiry, every 5 minutes
select cron.schedule('pixhub-housekeeping', '*/5 * * * *', $$ select public.run_housekeeping(); $$);

-- Email delivery for notifications, every 5 minutes
select cron.schedule('pixhub-notification-emails', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-notification-emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR-CRON-SECRET'),
    body := '{}'::jsonb
  );
$$);

-- Housekeeping: delete read notifications older than 90 days, nightly 02:00 Colombo (20:30 UTC)
select cron.schedule('pixhub-cleanup', '30 20 * * *', $$
  delete from public.notifications where read_at is not null and created_at < now() - interval '90 days';
$$);

-- To remove: select cron.unschedule('pixhub-housekeeping'); etc.
