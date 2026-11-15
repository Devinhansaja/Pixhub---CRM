-- =====================================================================
-- Email campaign scheduler: calls the CRM every minute so campaigns send
-- at their own pace (breaks, daily limits, hours, follow-ups).
--
-- 1. Supabase → Database → Extensions: enable "pg_cron" and "pg_net".
-- 2. Replace YOUR-CRON-SECRET with the same value as CRON_SECRET in Vercel.
-- 3. Run this once in the SQL Editor.
-- =====================================================================
select cron.unschedule('pixhub-email-tick') where exists (select 1 from cron.job where jobname = 'pixhub-email-tick');

select cron.schedule('pixhub-email-tick', '* * * * *', $$
  select net.http_post(
    url := 'https://pixhub-crm.vercel.app/api/email/tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR-CRON-SECRET'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$$);

-- Check it's running:   select * from cron.job_run_details order by start_time desc limit 5;
-- Stop it:              select cron.unschedule('pixhub-email-tick');
