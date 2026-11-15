-- =====================================================================
-- PIXhub Sales CRM — Email campaigns (Resend)
--   * campaigns with audience filters, custom sending speed ("breaks"),
--     sending hours/days, manager approval, AI review, auto follow-ups
--   * per-email queue with delivery status
--   * unsubscribe tokens, bounce / complaint tracking, auto-pause
-- =====================================================================

-- ---------------------------------------------------------------------
-- Contacts: email deliverability + unsubscribe token
-- ---------------------------------------------------------------------
alter table public.contacts
  add column email_status text not null default 'unknown'
    check (email_status in ('unknown', 'delivered', 'bounced', 'complained')),
  add column unsubscribe_token uuid not null default gen_random_uuid();
create unique index contacts_unsub_token_uidx on public.contacts(unsubscribe_token);

-- ---------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------
create type public.campaign_status as enum
  ('draft', 'pending_approval', 'approved', 'sending', 'paused', 'completed', 'cancelled');

create table public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 150),
  status public.campaign_status not null default 'draft',
  audience jsonb not null default '{}'::jsonb,          -- same filters as All Leads (import, industry, district, service, min_score, …)
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 8000),
  -- Follow-ups (sent only if the lead hasn't replied / progressed / opted out)
  followup_enabled boolean not null default false,
  followup_days int not null default 4 check (followup_days between 1 and 30),
  followup1_subject text, followup1_body text,
  followup2_subject text, followup2_body text,
  -- Sending speed and schedule (all customisable)
  daily_limit int not null default 50 check (daily_limit between 1 and 2000),
  min_gap_minutes numeric(6,2) not null default 1 check (min_gap_minutes >= 1),
  max_gap_minutes numeric(6,2) not null default 3,
  send_start_hour int not null default 9 check (send_start_hour between 0 and 23),
  send_end_hour int not null default 17 check (send_end_hour between 1 and 24),
  send_days int[] not null default '{1,2,3,4,5}',      -- ISO weekday 1=Mon … 7=Sun, Asia/Colombo
  ai_review boolean not null default true,
  -- Auto-pause protection
  max_bounce_rate numeric(5,2) not null default 5 check (max_bounce_rate between 0.5 and 50),
  -- Workflow
  review_note text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  started_at timestamptz,
  next_send_at timestamptz,
  paused_reason text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_gap_order check (max_gap_minutes >= min_gap_minutes),
  constraint campaign_hours_order check (send_end_hour > send_start_hour),
  constraint campaign_days check (send_days <@ array[1,2,3,4,5,6,7] and cardinality(send_days) between 1 and 7)
);
create index email_campaigns_status_idx on public.email_campaigns(status);

-- ---------------------------------------------------------------------
-- Individual emails (queue + history)
-- ---------------------------------------------------------------------
create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  step int not null default 0 check (step between 0 and 2),   -- 0 = first email, 1-2 = follow-ups
  to_email text not null,
  subject text,
  body text,
  status text not null default 'queued' check (status in
    ('queued', 'sending', 'sent', 'delivered', 'opened', 'bounced', 'complained', 'failed', 'ai_rejected', 'skipped', 'replied')),
  due_at timestamptz not null default now(),       -- earliest time it may be sent (follow-ups: +N days)
  sent_at timestamptz,
  provider_id text,
  ai_review jsonb,                                  -- {ok, score, issues[]}
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, contact_id, step)
);
create index email_messages_queue_idx on public.email_messages(campaign_id, due_at) where status = 'queued';
create index email_messages_contact_idx on public.email_messages(contact_id, created_at desc);
create unique index email_messages_provider_uidx on public.email_messages(provider_id) where provider_id is not null;

-- ---------------------------------------------------------------------
-- updated_at + approval guards
-- ---------------------------------------------------------------------
create trigger email_campaigns_touch before update on public.email_campaigns for each row execute function public.touch_updated_at();
create trigger email_messages_touch before update on public.email_messages for each row execute function public.touch_updated_at();

create or replace function public.email_campaign_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare me public.user_role := public.current_user_role();
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status and auth.uid() is not null then
    -- Approving: admin, or a manager who did not create the campaign
    if new.status = 'approved' then
      if old.status not in ('pending_approval', 'draft') then raise exception 'Only drafts or submitted campaigns can be approved'; end if;
      if not (me = 'admin' or (me = 'sales_manager' and new.created_by is distinct from auth.uid())) then
        raise exception 'Campaigns must be approved by an admin, or by a manager other than the creator';
      end if;
      new.approved_by := auth.uid(); new.approved_at := now();
    end if;
    if new.status = 'sending' and old.status not in ('approved', 'paused') then
      raise exception 'A campaign must be approved before it can start';
    end if;
    if new.status = 'draft' then new.approved_by := null; new.approved_at := null; end if;
  end if;
  -- Content changes after approval send it back for review
  if tg_op = 'UPDATE' and old.status in ('approved', 'sending', 'paused') and new.status = old.status
     and (new.subject, new.body, coalesce(new.followup1_body, ''), coalesce(new.followup2_body, ''), new.audience)
         is distinct from (old.subject, old.body, coalesce(old.followup1_body, ''), coalesce(old.followup2_body, ''), old.audience) then
    raise exception 'Approved campaigns can''t be edited. Pause it and create a new version, or move it back to draft.';
  end if;
  return new;
end $$;
create trigger email_campaign_workflow before update on public.email_campaigns
  for each row execute function public.email_campaign_workflow();

create or replace function public.email_campaign_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce((select full_name from public.profiles where id = auth.uid()), 'System');
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status = 'pending_approval' then
    perform public.notify(m.id, 'Campaign needs approval: ' || new.name, 'Submitted by ' || actor, '/campaigns/' || new.id, 'campaign', true)
      from public.profiles m where m.is_active and (m.role = 'admin' or (m.role = 'sales_manager' and m.id is distinct from new.created_by));
  elsif new.status = 'approved' then
    perform public.notify(new.created_by, 'Campaign approved: ' || new.name, 'Approved by ' || actor || '. You can start sending.', '/campaigns/' || new.id, 'campaign', true);
  elsif new.status = 'draft' and old.status = 'pending_approval' then
    perform public.notify(new.created_by, 'Changes requested: ' || new.name, coalesce(new.review_note, ''), '/campaigns/' || new.id, 'campaign', true);
  elsif new.status = 'paused' and new.paused_reason is not null and auth.uid() is null then
    perform public.notify(new.created_by, 'Campaign auto-paused: ' || new.name, new.paused_reason, '/campaigns/' || new.id, 'campaign', true, true);
  elsif new.status = 'completed' then
    perform public.notify(new.created_by, 'Campaign finished: ' || new.name, 'All emails have been processed.', '/campaigns/' || new.id, 'campaign', true, true);
  end if;
  return null;
end $$;
create trigger email_campaign_notify after update on public.email_campaigns
  for each row execute function public.email_campaign_notify();

-- When an email is sent / replied, reflect it on the lead (timeline + last contacted)
create or replace function public.email_message_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'sent' and old.status is distinct from 'sent' then
    update public.contacts set last_contacted_at = coalesce(new.sent_at, now()),
      stage = case when stage in ('new', 'researching') then 'contacted'::public.sales_stage else stage end
     where id = new.contact_id;
    insert into public.deal_activities (contact_id, type, description, metadata)
    values (new.contact_id, 'email', 'Email sent: “' || coalesce(new.subject, '') || '”' || case when new.step > 0 then ' (follow-up ' || new.step || ')' else '' end,
            jsonb_build_object('campaign_id', new.campaign_id, 'message_id', new.id));
  elsif new.status in ('bounced', 'complained') and old.status is distinct from new.status then
    update public.contacts set email_status = new.status,
      do_not_contact = case when new.status = 'complained' then true else do_not_contact end,
      opt_out_reason = case when new.status = 'complained' then 'Marked our email as spam' else opt_out_reason end
     where id = new.contact_id;
    -- stop any further emails to this contact
    update public.email_messages set status = 'skipped', error = 'Address ' || new.status
     where contact_id = new.contact_id and status = 'queued';
  elsif new.status = 'delivered' and old.status in ('sent', 'sending') then
    update public.contacts set email_status = 'delivered' where id = new.contact_id and email_status = 'unknown';
  end if;
  return null;
end $$;
create trigger email_message_after_update after update on public.email_messages
  for each row execute function public.email_message_after_update();

-- Staff record a reply: stops follow-ups for that contact
create or replace function public.mark_email_replied(p_contact uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- anyone who can work this lead (incl. its sales executive) may record a reply
  if not exists (select 1 from public.contacts where id = p_contact and public.can_access_owner(assigned_to)) then
    raise exception 'Lead not found or not accessible';
  end if;
  update public.email_messages set status = 'skipped', error = 'Lead replied'
   where contact_id = p_contact and status = 'queued' and step > 0;
  get diagnostics n = row_count;
  update public.email_messages set status = 'replied'
   where id = (select id from public.email_messages where contact_id = p_contact and status in ('sent','delivered','opened') order by sent_at desc nulls last limit 1);
  insert into public.deal_activities (contact_id, type, description, created_by) values (p_contact, 'email', 'Reply received by email (recorded by staff) — follow-ups stopped', auth.uid());
  update public.contacts set stage = case when stage in ('new','researching','contacted') then 'interested'::public.sales_stage else stage end where id = p_contact;
  return n;
end $$;

-- Public unsubscribe (no login): token from the email link
create or replace function public.email_unsubscribe(p_token uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select id, company_name, do_not_contact into c from public.contacts where unsubscribe_token = p_token;
  if c.id is null then return null; end if;
  if not c.do_not_contact then
    update public.contacts set do_not_contact = true, opt_out_reason = 'Unsubscribed via email link' where id = c.id;
    insert into public.deal_activities (contact_id, type, description) values (c.id, 'email', 'Unsubscribed from emails via the link in our email');
  end if;
  update public.email_messages set status = 'skipped', error = 'Unsubscribed' where contact_id = c.id and status = 'queued';
  return c.company_name;
end $$;
grant execute on function public.email_unsubscribe(uuid) to anon, authenticated;

-- Per-campaign stats (RLS applies)
create or replace function public.campaign_stats(p_campaign uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'total', count(*),
    'queued', count(*) filter (where status = 'queued'),
    'sent', count(*) filter (where status in ('sent','delivered','opened','replied','bounced','complained')),
    'delivered', count(*) filter (where status in ('delivered','opened','replied')),
    'opened', count(*) filter (where status in ('opened')),
    'replied', count(*) filter (where status = 'replied'),
    'bounced', count(*) filter (where status = 'bounced'),
    'complained', count(*) filter (where status = 'complained'),
    'failed', count(*) filter (where status = 'failed'),
    'ai_rejected', count(*) filter (where status = 'ai_rejected'),
    'skipped', count(*) filter (where status = 'skipped'),
    'sent_today', count(*) filter (where sent_at >= date_trunc('day', now() at time zone 'Asia/Colombo') at time zone 'Asia/Colombo'),
    'followups_sent', count(*) filter (where step > 0 and sent_at is not null)
  ) from public.email_messages where campaign_id = p_campaign
$$;

-- AI review usage is logged per campaign creator
alter table public.ai_requests drop constraint ai_requests_feature_check;
alter table public.ai_requests add constraint ai_requests_feature_check
  check (feature in ('chat','draft_message','summary','recommend_services','email_review'));

-- ---------------------------------------------------------------------
-- RLS: campaigns are run by managers/admins; executives don't send bulk email
-- ---------------------------------------------------------------------
alter table public.email_campaigns enable row level security;
alter table public.email_messages enable row level security;

create policy campaigns_select on public.email_campaigns for select to authenticated using (public.is_manager_or_admin());
create policy campaigns_insert on public.email_campaigns for insert to authenticated
  with check (public.is_manager_or_admin() and created_by = auth.uid());
create policy campaigns_update on public.email_campaigns for update to authenticated
  using (public.is_manager_or_admin()) with check (public.is_manager_or_admin());
create policy campaigns_delete on public.email_campaigns for delete to authenticated
  using (public.is_admin() or (created_by = auth.uid() and status = 'draft'));

-- Everyone sees email history of leads they can access; only managers/admins queue emails
create policy email_messages_select on public.email_messages for select to authenticated
  using (exists (select 1 from public.contacts c where c.id = contact_id));
create policy email_messages_insert on public.email_messages for insert to authenticated
  with check (public.is_manager_or_admin() and exists (select 1 from public.contacts c where c.id = contact_id));
create policy email_messages_update on public.email_messages for update to authenticated
  using (public.is_manager_or_admin()) with check (public.is_manager_or_admin());

-- Sender settings default
insert into public.system_settings (key, value) values
  ('email', jsonb_build_object('from_name', 'PIXhub.lk', 'from_email', 'hello@pixhub.lk', 'reply_to', 'info@pixhub.lk',
                               'footer', 'PIXhub.lk · Sri Lanka · info@pixhub.lk · 0712585960'))
on conflict (key) do nothing;
