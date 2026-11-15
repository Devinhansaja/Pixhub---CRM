-- =====================================================================
-- PIXhub Sales CRM — Phase 3: AI assistant usage, lead enrichment,
-- WhatsApp Business Platform (opt-in, approved templates, delivery
-- status, inbound messages), advanced analytics
-- =====================================================================

-- ---------------------------------------------------------------------
-- AI requests: audit + per-user rate limiting (no prompts/outputs stored)
-- ---------------------------------------------------------------------
create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  feature text not null check (feature in ('chat','draft_message','summary','recommend_services')),
  contact_id uuid references public.contacts(id) on delete set null,
  model text,
  input_tokens int,
  output_tokens int,
  status text not null default 'ok' check (status in ('ok','refused','error')),
  created_at timestamptz not null default now()
);
create index ai_requests_user_idx on public.ai_requests(user_id, created_at desc);
alter table public.ai_requests enable row level security;
create policy ai_requests_select on public.ai_requests for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy ai_requests_insert on public.ai_requests for insert to authenticated with check (user_id = auth.uid());

create or replace function public.ai_requests_last_hour()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.ai_requests where user_id = auth.uid() and created_at > now() - interval '1 hour'
$$;

-- ---------------------------------------------------------------------
-- Lead enrichment: results of authorised checks of a lead's public website.
-- Every row keeps the URL checked and the time; nothing is inferred.
-- ---------------------------------------------------------------------
create table public.lead_enrichment (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  source_url text not null,
  final_url text,
  checked_at timestamptz not null default now(),
  http_status int,
  is_live boolean not null,
  uses_https boolean,
  mobile_friendly boolean,       -- has a responsive viewport meta tag
  page_title text,
  meta_description text,
  facebook_link text,            -- a facebook.com link found on the page
  has_ecommerce_signals boolean, -- cart/checkout/shop markers found in the HTML
  error text,
  checked_by uuid references public.profiles(id) on delete set null default auth.uid()
);
create index lead_enrichment_contact_idx on public.lead_enrichment(contact_id, checked_at desc);
alter table public.lead_enrichment enable row level security;
create policy enrichment_select on public.lead_enrichment for select to authenticated
  using (exists (select 1 from public.contacts c where c.id = contact_id));
create policy enrichment_insert on public.lead_enrichment for insert to authenticated
  with check (checked_by = auth.uid() and exists (select 1 from public.contacts c where c.id = contact_id));

-- ---------------------------------------------------------------------
-- WhatsApp Business Platform
-- ---------------------------------------------------------------------
alter table public.contacts
  add column whatsapp_opt_in_at timestamptz,
  add column whatsapp_opt_in_source text check (whatsapp_opt_in_source is null or length(whatsapp_opt_in_source) <= 300),
  add column whatsapp_opt_in_by uuid references public.profiles(id) on delete set null,
  add column last_inbound_at timestamptz;

-- Opting out clears opt-in
create or replace function public.contacts_optin_guard()
returns trigger language plpgsql as $$
begin
  if new.do_not_contact then
    new.whatsapp_opt_in_at := null; new.whatsapp_opt_in_source := null; new.whatsapp_opt_in_by := null;
  end if;
  return new;
end $$;
create trigger contacts_optin_guard before insert or update on public.contacts
  for each row execute function public.contacts_optin_guard();

-- Templates approved in Meta WhatsApp Manager (name + language must match Meta exactly)
create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name ~ '^[a-z0-9_]+$' and length(name) <= 512),
  language text not null default 'en' check (language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  category text not null default 'marketing' check (category in ('marketing','utility')),
  body_preview text not null check (length(body_preview) <= 1024),
  -- CRM fields filling {{1}}, {{2}}… in order
  params text[] not null default '{}' check (params <@ array['company','contact_person','services','city','sender']::text[]),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name, language)
);
alter table public.whatsapp_templates enable row level security;
create policy wat_read on public.whatsapp_templates for select to authenticated using (true);
create policy wat_admin on public.whatsapp_templates for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.communication_logs
  add column external_id text,
  add column delivery_status text check (delivery_status is null or delivery_status in ('accepted','sent','delivered','read','failed')),
  add column delivery_error text,
  add column template_name text;
create unique index comm_logs_external_uidx on public.communication_logs(external_id) where external_id is not null;

-- Cloud API sends need consent: opt-in, or a reply window opened by the customer (24h)
create or replace function public.communication_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select do_not_contact, whatsapp_opt_in_at, last_inbound_at into c from public.contacts where id = new.contact_id;
  if new.direction = 'outbound' and c.do_not_contact then
    raise exception 'This contact is marked do-not-contact';
  end if;
  if new.direction = 'outbound' and new.source = 'whatsapp_cloud_api' then
    if new.template_name is not null and c.whatsapp_opt_in_at is null then
      raise exception 'WhatsApp template messages need recorded opt-in from this contact';
    end if;
    if new.template_name is null and (c.last_inbound_at is null or c.last_inbound_at < now() - interval '24 hours') then
      raise exception 'Free-text WhatsApp messages are only allowed within 24 hours of the customer''s last message';
    end if;
  end if;
  return new;
end $$;

-- Inbound messages: mark replied and remember the time (opens the 24h window)
create or replace function public.communication_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.contacts set
    whatsapp_status = case when new.channel = 'whatsapp' then new.status else whatsapp_status end,
    last_inbound_at = case when new.direction = 'inbound' then new.created_at else last_inbound_at end,
    last_contacted_at = case when new.status in ('contacted', 'replied', 'interested', 'follow_up_required', 'not_interested')
                             then new.created_at else last_contacted_at end,
    stage = case
      when new.status = 'contacted' and stage in ('new', 'researching') then 'contacted'::public.sales_stage
      when new.status = 'interested' and stage in ('new', 'researching', 'contacted') then 'interested'::public.sales_stage
      when new.status = 'not_interested' and stage in ('new', 'researching', 'contacted') then 'not_interested'::public.sales_stage
      else stage end
  where id = new.contact_id;
  return null;
end $$;

-- Webhook delivery-status updates may only move forward (sent → delivered → read), failed is final
create or replace function public.apply_whatsapp_status(p_external_id text, p_status text, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
declare rank_new int := array_position(array['accepted','sent','delivered','read'], p_status);
begin
  update public.communication_logs set
    delivery_status = p_status,
    delivery_error = coalesce(left(p_error, 500), delivery_error)
  where external_id = p_external_id
    and coalesce(delivery_status, 'accepted') <> 'failed'
    and (p_status = 'failed' or rank_new > coalesce(array_position(array['accepted','sent','delivered','read'], delivery_status), 0));
end $$;
revoke execute on function public.apply_whatsapp_status(text, text, text) from public, anon, authenticated;
grant execute on function public.apply_whatsapp_status(text, text, text) to service_role;  -- webhook only

-- Per-user hourly send counter (app enforces a cap; prevents bulk messaging)
create or replace function public.whatsapp_sends_last_hour()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.communication_logs
   where created_by = auth.uid() and source = 'whatsapp_cloud_api' and direction = 'outbound'
     and created_at > now() - interval '1 hour'
$$;

-- ---------------------------------------------------------------------
-- Advanced analytics (security invoker → scoped by RLS)
-- ---------------------------------------------------------------------
create or replace function public.advanced_analytics()
returns jsonb language sql stable security invoker set search_path = public as $$
  with c as (select * from public.contacts),
  comm as (select * from public.communication_logs where channel = 'whatsapp')
  select jsonb_build_object(
    -- Outreach funnel: distinct leads reaching each step
    'outreach_funnel', jsonb_build_array(
      jsonb_build_object('name', 'Message prepared', 'value', (select count(distinct contact_id) from comm where status in ('prepared','chat_opened','contacted'))),
      jsonb_build_object('name', 'Contacted (confirmed)', 'value', (select count(distinct contact_id) from comm where status = 'contacted')),
      jsonb_build_object('name', 'Replied', 'value', (select count(distinct contact_id) from comm where status in ('replied','interested'))),
      jsonb_build_object('name', 'Interested', 'value', (select count(distinct contact_id) from comm where status = 'interested'))
    ),
    -- Does the lead score predict results? Conversion by score band
    'score_bands', (select coalesce(jsonb_agg(x order by x.band), '[]') from (
        select case when lead_score >= 80 then '80-100' when lead_score >= 60 then '60-79' when lead_score >= 40 then '40-59' else '0-39' end as band,
               count(*) as leads,
               count(*) filter (where stage not in ('new','researching')) as contacted,
               count(*) filter (where stage in ('interested','meeting_scheduled','quotation_sent','negotiation','won')) as interested,
               count(*) filter (where stage = 'won') as won
          from c group by 1) x),
    -- Reply rate by industry (min 5 contacted leads)
    'reply_by_industry', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(nullif(trim(c.industry), ''), 'Unknown') as name,
               count(distinct c.id) as contacted,
               count(distinct c.id) filter (where exists (select 1 from comm m where m.contact_id = c.id and m.status in ('replied','interested'))) as replied
          from c where exists (select 1 from comm m where m.contact_id = c.id and m.status = 'contacted')
         group by 1 having count(distinct c.id) >= 5 order by 2 desc limit 15) x),
    -- Reply rate by message template
    'reply_by_template', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(t.name, m.template_name, 'Custom message') as name,
               count(distinct m.contact_id) as contacted,
               count(distinct m.contact_id) filter (where exists (
                 select 1 from comm r where r.contact_id = m.contact_id and r.status in ('replied','interested') and r.created_at > m.created_at)) as replied
          from comm m left join public.message_templates t on t.id = m.template_id
         where m.status = 'contacted'
         group by 1 order by 2 desc limit 15) x),
    -- Sales cycle
    'avg_days_to_win', (select round(avg(extract(epoch from (won_at - created_at)) / 86400)::numeric, 1) from c where won_at is not null),
    'avg_days_deal_close', (select round(avg(extract(epoch from (closed_at - created_at)) / 86400)::numeric, 1) from public.deals where stage = 'won'),
    -- Win rate by service (closed deals)
    'win_rate_by_service', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(s.name, 'Unspecified') as name,
               count(*) filter (where d.stage = 'won') as won,
               count(*) filter (where d.stage in ('lost','not_interested')) as lost,
               coalesce(sum(d.value) filter (where d.stage = 'won'), 0) as revenue,
               round(avg(d.value) filter (where d.stage = 'won'), 0) as avg_deal
          from public.deals d left join public.services s on s.id = d.service_id
         where d.stage in ('won','lost','not_interested')
         group by 1 order by 2 desc) x),
    -- Team activity, last 30 days
    'activity_30d', (select coalesce(jsonb_agg(x), '[]') from (
        select p.full_name as name,
               (select count(*) from public.communication_logs l where l.created_by = p.id and l.direction = 'outbound' and l.status = 'contacted' and l.created_at > now() - interval '30 days') as messages,
               (select count(*) from public.deal_activities a where a.created_by = p.id and a.type in ('note','call','meeting') and a.created_at > now() - interval '30 days') as notes,
               (select count(*) from public.tasks t where t.assigned_to = p.id and t.status = 'done' and t.completed_at > now() - interval '30 days') as tasks_done,
               (select count(*) from public.follow_ups f where f.assigned_to = p.id and f.status = 'done' and f.completed_at > now() - interval '30 days') as follow_ups_done,
               (select count(*) from public.deals d where d.assigned_to = p.id and d.stage = 'won' and d.closed_at > now() - interval '30 days') as deals_won
          from public.profiles p
         where p.is_active and exists (select 1 from c where c.assigned_to = p.id)
         order by p.full_name) x),
    -- Leads going cold: interested or later, no contact for 14+ days, no pending follow-up
    'going_cold', (select count(*) from c
        where stage in ('interested','meeting_scheduled','quotation_sent','negotiation')
          and coalesce(last_contacted_at, created_at) < now() - interval '14 days'
          and next_follow_up_at is null),
    'enrichment', jsonb_build_object(
        'checked', (select count(distinct e.contact_id) from public.lead_enrichment e join c on c.id = e.contact_id),
        'live', (select count(*) from c where website_is_live is true),
        'offline', (select count(*) from c where website_is_live is false),
        'no_website', (select count(*) from c where website is null)),
    'opted_in', (select count(*) from c where whatsapp_opt_in_at is not null)
  )
$$;
