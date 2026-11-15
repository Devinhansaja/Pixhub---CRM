-- =====================================================================
-- PIXhub Sales CRM — helper functions, triggers, scoring, RLS
-- =====================================================================

-- ---------------------------------------------------------------------
-- Role helpers (security definer so they can read profiles under RLS)
-- ---------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

create or replace function public.is_manager_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() in ('admin', 'sales_manager'), false)
$$;

-- Can the current user see/work records owned by `owner`?
--   admin: everything · manager: own, team members' and unassigned · executive: own only
create or replace function public.can_access_owner(owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.current_user_role()
    when 'admin' then true
    when 'sales_manager' then owner is null or owner = auth.uid()
      or exists (select 1 from public.profiles p where p.id = owner and p.manager_id = auth.uid())
    when 'sales_executive' then owner = auth.uid()
    else false
  end
$$;

-- ---------------------------------------------------------------------
-- New auth user → profile. First user ever becomes admin.
-- Role is NEVER taken from user metadata (it is user-controlled).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    case when not exists (select 1 from public.profiles) then 'admin'::public.user_role
         else 'sales_executive'::public.user_role end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Only admins can change role / manager / active flag.
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role
       or new.manager_id is distinct from old.manager_id
       or new.is_active is distinct from old.is_active
       or new.email is distinct from old.email then
      raise exception 'Only administrators can change role, team, status or email';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ---------------------------------------------------------------------
-- Generic updated_at
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger deals_touch before update on public.deals for each row execute function public.touch_updated_at();
create trigger tasks_touch before update on public.tasks for each row execute function public.touch_updated_at();
create trigger quotations_touch before update on public.quotations for each row execute function public.touch_updated_at();
create trigger templates_touch before update on public.message_templates for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Explainable lead score (0–100).
-- Every factor is tagged "fact" (present in data / recorded by staff) or
-- "assumption" (inferred from category or missing data, needs verification).
-- ---------------------------------------------------------------------
create or replace function public.compute_lead_score(c public.contacts)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f jsonb := '[]'::jsonb;
  s int := 0;
  fit int;
  pts int;
begin
  if c.do_not_contact then
    return jsonb_build_object('score', 0, 'factors', jsonb_build_array(jsonb_build_object(
      'factor', 'Do not contact', 'points', 0, 'kind', 'fact',
      'evidence', 'Marked do-not-contact / opted out — excluded from outreach')));
  end if;

  -- Business fit (max 35): strongest service recommendation
  select coalesce(max(confidence), 0) into fit
    from public.lead_service_recommendations where contact_id = c.id;
  pts := round(fit * 0.35);
  if pts > 0 then
    s := s + pts;
    f := f || jsonb_build_object('factor', 'Business fit', 'points', pts, 'kind', 'assumption',
      'evidence', 'Best service match confidence ' || fit || '% (from business category)');
  end if;

  -- Reachability (max 28)
  if c.mobile is not null then
    s := s + 15;
    f := f || jsonb_build_object('factor', 'Valid mobile number', 'points', 15, 'kind', 'fact',
      'evidence', 'Valid Sri Lankan mobile format (WhatsApp account NOT verified)');
  end if;
  if c.email is not null then
    s := s + 5;
    f := f || jsonb_build_object('factor', 'Email available', 'points', 5, 'kind', 'fact', 'evidence', c.email);
  end if;
  if c.landline is not null then
    s := s + 3;
    f := f || jsonb_build_object('factor', 'Landline available', 'points', 3, 'kind', 'fact', 'evidence', c.landline);
  end if;
  if c.contact_person is not null then
    s := s + 5;
    f := f || jsonb_build_object('factor', 'Named contact person', 'points', 5, 'kind', 'fact', 'evidence', c.contact_person);
  end if;

  -- Online presence (max 10)
  if c.website is null then
    s := s + 10;
    f := f || jsonb_build_object('factor', 'Website opportunity', 'points', 10, 'kind', 'assumption',
      'evidence', 'No website listed in imported data (not verified online)');
  elsif c.website_verified_at is not null and c.website_is_live = false then
    s := s + 10;
    f := f || jsonb_build_object('factor', 'Website offline', 'points', 10, 'kind', 'fact',
      'evidence', 'Verified offline ' || to_char(c.website_verified_at at time zone 'Asia/Colombo', 'YYYY-MM-DD') || ' via ' || coalesce(c.website_verified_source, 'manual check'));
  end if;
  if c.facebook_url is not null then
    s := s + 3;
    f := f || jsonb_build_object('factor', 'Facebook page listed', 'points', 3,
      'kind', case when c.facebook_verified_at is not null then 'fact' else 'assumption' end,
      'evidence', case when c.facebook_verified_at is not null
        then 'Verified ' || to_char(c.facebook_verified_at at time zone 'Asia/Colombo', 'YYYY-MM-DD')
        else 'URL in data, activity not verified' end);
  end if;

  -- Engagement (max 15) — only from recorded outreach
  pts := case c.whatsapp_status
    when 'replied' then 10 when 'interested' then 15 when 'follow_up_required' then 6 else 0 end;
  if pts > 0 then
    s := s + pts;
    f := f || jsonb_build_object('factor', 'Engagement', 'points', pts, 'kind', 'fact',
      'evidence', 'Outreach status: ' || c.whatsapp_status::text || ' (recorded by staff)');
  end if;

  -- Sales activity (max 20)
  pts := case c.stage
    when 'contacted' then 3 when 'interested' then 10 when 'meeting_scheduled' then 14
    when 'quotation_sent' then 17 when 'negotiation' then 20 when 'won' then 20 else 0 end;
  if pts > 0 then
    s := s + pts;
    f := f || jsonb_build_object('factor', 'Sales stage', 'points', pts, 'kind', 'fact',
      'evidence', 'Stage: ' || replace(c.stage::text, '_', ' '));
  end if;

  if c.stage in ('lost', 'not_interested') or c.whatsapp_status = 'not_interested' then
    f := f || jsonb_build_object('factor', 'Declined', 'points', -greatest(s - 10, 0), 'kind', 'fact',
      'evidence', 'Lead marked lost / not interested — score capped at 10');
    s := least(s, 10);
  end if;

  return jsonb_build_object('score', least(greatest(s, 0), 100), 'factors', f);
end $$;

-- Contacts BEFORE trigger: timestamps, guard rails, scoring
create or replace function public.contacts_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.assigned_to is distinct from old.assigned_to
       and auth.uid() is not null and public.current_user_role() = 'sales_executive' then
      raise exception 'Sales executives cannot reassign leads';
    end if;
    if new.stage = 'won' and old.stage <> 'won' then new.won_at := now(); end if;
    if new.stage <> 'won' then new.won_at := null; end if;
  elsif new.stage = 'won' then
    new.won_at := coalesce(new.won_at, now());
  end if;

  if new.do_not_contact and new.opted_out_at is null then new.opted_out_at := now(); end if;
  if not new.do_not_contact then new.opted_out_at := null; end if;

  new.company_name := trim(new.company_name);
  new.updated_at := now();
  r := public.compute_lead_score(new);
  new.lead_score := (r->>'score')::int;
  new.score_breakdown := r->'factors';
  return new;
end $$;

create trigger contacts_before_write before insert or update on public.contacts
  for each row execute function public.contacts_before_write();

-- ---------------------------------------------------------------------
-- Audit logging (updates/deletes on business records; inserts on small tables)
-- ---------------------------------------------------------------------
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
  values (
    auth.uid(), tg_op, tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

-- Explicit audit entries from the app (exports, imports, bulk actions)
create or replace function public.log_audit(p_action text, p_table text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.audit_logs (actor_id, action, table_name, new_data)
  values (auth.uid(), left(p_action, 50), left(p_table, 50), p_details);
end $$;

-- contacts: skip noisy updated_at-only touches (e.g. re-scoring)
create trigger contacts_audit after update on public.contacts for each row
  when (old.stage is distinct from new.stage or old.assigned_to is distinct from new.assigned_to
        or old.do_not_contact is distinct from new.do_not_contact or old.mobile is distinct from new.mobile
        or old.company_name is distinct from new.company_name or old.estimated_value is distinct from new.estimated_value)
  execute function public.audit_trigger();
create trigger contacts_audit_del after delete on public.contacts for each row execute function public.audit_trigger();
create trigger profiles_audit after insert or update or delete on public.profiles for each row execute function public.audit_trigger();
create trigger deals_audit after insert or update or delete on public.deals for each row execute function public.audit_trigger();
create trigger quotations_audit after insert or update or delete on public.quotations for each row execute function public.audit_trigger();
create trigger services_audit after insert or update or delete on public.services for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------
-- Follow-ups keep contacts.next_follow_up_at in sync
-- ---------------------------------------------------------------------
create or replace function public.sync_next_follow_up()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid := coalesce(new.contact_id, old.contact_id);
begin
  update public.contacts set next_follow_up_at = (
    select min(due_at) from public.follow_ups where contact_id = cid and status = 'pending'
  ) where id = cid;
  return null;
end $$;

create trigger follow_ups_sync after insert or update or delete on public.follow_ups
  for each row execute function public.sync_next_follow_up();

-- ---------------------------------------------------------------------
-- Communication logs: block do-not-contact, update contact outreach status
-- ---------------------------------------------------------------------
create or replace function public.communication_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'outbound' and exists (select 1 from public.contacts where id = new.contact_id and do_not_contact) then
    raise exception 'This contact is marked do-not-contact';
  end if;
  return new;
end $$;

create or replace function public.communication_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.contacts set
    whatsapp_status = case when new.channel = 'whatsapp' then new.status else whatsapp_status end,
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

create trigger communication_before_insert before insert on public.communication_logs
  for each row execute function public.communication_before_insert();
create trigger communication_after_insert after insert on public.communication_logs
  for each row execute function public.communication_after_insert();

-- ---------------------------------------------------------------------
-- Smart classification: rules + data gaps → recommendations → re-score.
-- Runs as the caller, so RLS limits it to contacts the caller can access.
-- ---------------------------------------------------------------------
create or replace function public.classify_contacts(p_ids uuid[])
returns int language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  if array_length(p_ids, 1) > 2000 then raise exception 'Max 2000 contacts per call'; end if;

  delete from public.lead_service_recommendations
   where contact_id = any(p_ids) and basis in ('industry_rule', 'data_gap');

  insert into public.lead_service_recommendations (contact_id, service_id, confidence, basis, reason, is_verified)
  select c.id, r.service_id, max(r.weight), 'industry_rule',
         string_agg(distinct r.reason || ' (keyword "' || r.keyword || '")', '; '), false
    from public.contacts c
    join public.classification_rules r
      on r.is_active and (coalesce(c.industry, '') || ' ' || c.company_name) ~* ('\m' || r.keyword || '\M')
   where c.id = any(p_ids)
   group by c.id, r.service_id
  on conflict (contact_id, service_id) do nothing;

  insert into public.lead_service_recommendations (contact_id, service_id, confidence, basis, reason, is_verified)
  select c.id, s.id, 45, 'data_gap', 'No website listed in imported data — verify before pitching', false
    from public.contacts c, public.services s
   where c.id = any(p_ids) and c.website is null and s.slug = 'corporate-website'
  on conflict (contact_id, service_id) do nothing;

  insert into public.lead_service_recommendations (contact_id, service_id, confidence, basis, reason, is_verified)
  select c.id, s.id, 35, 'data_gap', 'No Facebook page listed in imported data — verify before pitching', false
    from public.contacts c, public.services s
   where c.id = any(p_ids) and c.facebook_url is null and s.slug = 'social-media-management'
  on conflict (contact_id, service_id) do nothing;

  update public.contacts set updated_at = now() where id = any(p_ids);  -- fires re-scoring
  get diagnostics n = row_count;
  return n;
end $$;

-- Recompute score when recommendations change manually
create or replace function public.rescore_contact_from_rec()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.basis, old.basis) in ('manual', 'ai') then
    update public.contacts set updated_at = now() where id = coalesce(new.contact_id, old.contact_id);
  end if;
  return null;
end $$;
create trigger lsr_rescore after insert or update or delete on public.lead_service_recommendations
  for each row execute function public.rescore_contact_from_rec();

-- ---------------------------------------------------------------------
-- Dashboard aggregates (security invoker → respects RLS: each user sees
-- metrics for the leads they are allowed to access)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb language sql stable security invoker set search_path = public as $$
  with c as (select * from public.contacts),
  today as (select (now() at time zone 'Asia/Colombo')::date as d)
  select jsonb_build_object(
    'total_leads', (select count(*) from c),
    'new_leads_7d', (select count(*) from c where created_at > now() - interval '7 days'),
    'new_stage', (select count(*) from c where stage = 'new'),
    'qualified', (select count(*) from c where lead_score >= 60 and stage not in ('lost', 'not_interested')),
    'contacted', (select count(*) from c where stage not in ('new', 'researching')),
    'interested', (select count(*) from c where stage in ('interested', 'meeting_scheduled', 'quotation_sent', 'negotiation')),
    'quotations_sent', (select count(*) from c where stage = 'quotation_sent'),
    'won', (select count(*) from c where stage = 'won'),
    'lost', (select count(*) from c where stage in ('lost', 'not_interested')),
    'revenue', (select coalesce(sum(estimated_value), 0) from c where stage = 'won'),
    'pipeline_value', (select coalesce(sum(estimated_value), 0) from c
                        where stage in ('interested', 'meeting_scheduled', 'quotation_sent', 'negotiation')),
    'valid_mobiles', (select count(*) from c where mobile is not null),
    'do_not_contact', (select count(*) from c where do_not_contact),
    'overdue_follow_ups', (select count(*) from public.follow_ups where status = 'pending' and due_at < now()),
    'follow_ups_today', (select count(*) from public.follow_ups, today
                          where status = 'pending' and (due_at at time zone 'Asia/Colombo')::date = today.d),
    'meetings_upcoming', (select count(*) from public.follow_ups where status = 'pending' and channel = 'meeting' and due_at >= now()),
    'pending_quotations', (select count(*) from public.quotations where status in ('draft', 'pending_approval', 'approved', 'sent'))
  )
$$;

create or replace function public.dashboard_breakdowns()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'by_stage', (select coalesce(jsonb_agg(x), '[]') from (
        select stage::text as name, count(*) as value from public.contacts group by stage) x),
    'by_industry', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(nullif(trim(industry), ''), 'Unknown') as name, count(*) as value
          from public.contacts group by 1 order by 2 desc limit 10) x),
    'by_district', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(nullif(trim(district), ''), 'Unknown') as name, count(*) as value
          from public.contacts group by 1 order by 2 desc limit 15) x),
    'by_service', (select coalesce(jsonb_agg(x), '[]') from (
        select s.name, count(*) as value
          from public.lead_service_recommendations r
          join public.services s on s.id = r.service_id
          join public.contacts c on c.id = r.contact_id
         group by s.name order by 2 desc limit 12) x),
    'by_owner', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(p.full_name, 'Unassigned') as name,
               count(*) as leads,
               count(*) filter (where c.stage not in ('new', 'researching')) as contacted,
               count(*) filter (where c.stage = 'won') as won,
               coalesce(sum(c.estimated_value) filter (where c.stage = 'won'), 0) as revenue
          from public.contacts c left join public.profiles p on p.id = c.assigned_to
         group by p.full_name order by leads desc limit 15) x),
    'monthly', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
        select to_char(m, 'YYYY-MM') as month,
               (select count(*) from public.contacts c
                 where date_trunc('month', c.created_at at time zone 'Asia/Colombo') = m) as new_leads,
               (select count(*) from public.contacts c
                 where date_trunc('month', c.won_at at time zone 'Asia/Colombo') = m) as won,
               (select coalesce(sum(estimated_value), 0) from public.contacts c
                 where date_trunc('month', c.won_at at time zone 'Asia/Colombo') = m) as revenue
          from generate_series(
                 date_trunc('month', now() at time zone 'Asia/Colombo') - interval '11 months',
                 date_trunc('month', now() at time zone 'Asia/Colombo'),
                 interval '1 month') m) x)
  )
$$;

-- Distinct filter values for the leads table (respects RLS)
create or replace function public.lead_filter_options()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'districts', (select coalesce(jsonb_agg(d order by d), '[]') from (
        select distinct district d from public.contacts where district is not null and district <> '' limit 200) x),
    'industries', (select coalesce(jsonb_agg(i order by i), '[]') from (
        select industry i from public.contacts where industry is not null and industry <> ''
         group by industry order by count(*) desc limit 300) y)
  )
$$;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.classification_rules enable row level security;
alter table public.lead_imports enable row level security;
alter table public.contacts enable row level security;
alter table public.lead_service_recommendations enable row level security;
alter table public.deals enable row level security;
alter table public.deal_activities enable row level security;
alter table public.tasks enable row level security;
alter table public.follow_ups enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;
alter table public.message_templates enable row level security;
alter table public.communication_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.system_settings enable row level security;

-- organizations / settings / services / rules / templates: read for staff, write for admins (templates: managers too)
create policy org_read on public.organizations for select to authenticated using (true);
create policy org_admin on public.organizations for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy settings_read on public.system_settings for select to authenticated using (true);
create policy settings_admin on public.system_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy services_read on public.services for select to authenticated using (true);
create policy services_admin on public.services for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy rules_read on public.classification_rules for select to authenticated using (true);
create policy rules_admin on public.classification_rules for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy templates_read on public.message_templates for select to authenticated using (true);
create policy templates_write on public.message_templates for all to authenticated
  using (public.is_manager_or_admin()) with check (public.is_manager_or_admin());

-- profiles
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- imports: admins run them, managers can view history
create policy imports_read on public.lead_imports for select to authenticated using (public.is_manager_or_admin());
create policy imports_write on public.lead_imports for insert to authenticated with check (public.is_admin());
create policy imports_update on public.lead_imports for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- contacts
create policy contacts_select on public.contacts for select to authenticated
  using (public.can_access_owner(assigned_to));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (public.is_manager_or_admin() or (public.current_user_role() = 'sales_executive' and assigned_to = auth.uid()));
create policy contacts_update on public.contacts for update to authenticated
  using (public.can_access_owner(assigned_to))
  with check (public.is_manager_or_admin() or assigned_to = auth.uid());
create policy contacts_delete on public.contacts for delete to authenticated using (public.is_admin());

-- Child records of a contact: visible/editable if the parent contact is accessible
create policy lsr_all on public.lead_service_recommendations for all to authenticated
  using (exists (select 1 from public.contacts c where c.id = contact_id))
  with check (exists (select 1 from public.contacts c where c.id = contact_id));

create policy activities_select on public.deal_activities for select to authenticated
  using (exists (select 1 from public.contacts c where c.id = contact_id));
create policy activities_insert on public.deal_activities for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from public.contacts c where c.id = contact_id));
create policy activities_delete on public.deal_activities for delete to authenticated
  using (public.is_admin() or (created_by = auth.uid() and created_at > now() - interval '15 minutes'));

create policy comm_select on public.communication_logs for select to authenticated
  using (exists (select 1 from public.contacts c where c.id = contact_id));
create policy comm_insert on public.communication_logs for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from public.contacts c where c.id = contact_id));

create policy follow_ups_select on public.follow_ups for select to authenticated
  using (public.can_access_owner(assigned_to) and exists (select 1 from public.contacts c where c.id = contact_id));
create policy follow_ups_insert on public.follow_ups for insert to authenticated
  with check (exists (select 1 from public.contacts c where c.id = contact_id)
              and (assigned_to = auth.uid() or public.is_manager_or_admin()));
create policy follow_ups_update on public.follow_ups for update to authenticated
  using (public.can_access_owner(assigned_to)) with check (public.can_access_owner(assigned_to));
create policy follow_ups_delete on public.follow_ups for delete to authenticated
  using (public.is_manager_or_admin() or created_by = auth.uid());

-- deals
create policy deals_select on public.deals for select to authenticated using (public.can_access_owner(assigned_to));
create policy deals_insert on public.deals for insert to authenticated
  with check (exists (select 1 from public.contacts c where c.id = contact_id)
              and (assigned_to = auth.uid() or public.is_manager_or_admin()));
create policy deals_update on public.deals for update to authenticated
  using (public.can_access_owner(assigned_to)) with check (public.can_access_owner(assigned_to));
create policy deals_delete on public.deals for delete to authenticated using (public.is_manager_or_admin());

-- tasks
create policy tasks_select on public.tasks for select to authenticated
  using (created_by = auth.uid() or public.can_access_owner(assigned_to));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (created_by = auth.uid() and (assigned_to = auth.uid() or public.is_manager_or_admin()));
create policy tasks_update on public.tasks for update to authenticated
  using (created_by = auth.uid() or public.can_access_owner(assigned_to))
  with check (created_by = auth.uid() or public.can_access_owner(assigned_to));
create policy tasks_delete on public.tasks for delete to authenticated
  using (created_by = auth.uid() or public.is_manager_or_admin());

-- quotations
create policy quotations_select on public.quotations for select to authenticated
  using (exists (select 1 from public.contacts c where c.id = contact_id));
create policy quotations_insert on public.quotations for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from public.contacts c where c.id = contact_id));
create policy quotations_update on public.quotations for update to authenticated
  using (exists (select 1 from public.contacts c where c.id = contact_id))
  with check (exists (select 1 from public.contacts c where c.id = contact_id));
create policy quotations_delete on public.quotations for delete to authenticated using (public.is_manager_or_admin());

create or replace function public.protect_quotation_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_manager_or_admin()
     and (new.status = 'approved' and old.status is distinct from 'approved'
          or new.approved_by is distinct from old.approved_by) then
    raise exception 'Only managers can approve quotations';
  end if;
  return new;
end $$;
create trigger quotations_protect before update on public.quotations
  for each row execute function public.protect_quotation_approval();

create policy qitems_all on public.quotation_items for all to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id))
  with check (exists (select 1 from public.quotations q where q.id = quotation_id));

-- notifications: own only
create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_send on public.notifications for insert to authenticated
  with check (user_id = auth.uid() or public.is_manager_or_admin());

-- audit logs: admins read; writes only via security-definer trigger
create policy audit_admin_read on public.audit_logs for select to authenticated using (public.is_admin());
