-- PIXhub Sales CRM: ALL migrations in one file (generated from supabase/migrations).
-- Paste into Supabase SQL Editor of a NEW project and click Run once.

-- >>> 20261113000001_schema.sql
-- =====================================================================
-- PIXhub Sales CRM — core schema
-- Timezone: Asia/Colombo · Currency: LKR
-- =====================================================================
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- Timestamps are stored as timestamptz (UTC); date bucketing below and all UI
-- formatting use 'Asia/Colombo' explicitly.

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.user_role as enum ('admin', 'sales_manager', 'sales_executive');

create type public.sales_stage as enum (
  'new', 'researching', 'contacted', 'interested', 'meeting_scheduled',
  'quotation_sent', 'negotiation', 'won', 'lost', 'not_interested'
);

create type public.service_category as enum ('website', 'software', 'marketing');

-- WhatsApp / outreach status. "chat_opened" never implies the message was sent.
create type public.outreach_status as enum (
  'none', 'prepared', 'chat_opened', 'contacted', 'replied',
  'interested', 'follow_up_required', 'not_interested'
);

create type public.recommendation_basis as enum ('industry_rule', 'data_gap', 'manual', 'ai');
create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.task_status as enum ('todo', 'in_progress', 'done', 'cancelled');
create type public.follow_up_status as enum ('pending', 'done', 'missed', 'cancelled');
create type public.quotation_status as enum ('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected', 'expired');
create type public.import_status as enum ('processing', 'completed', 'failed', 'cancelled');

-- ---------------------------------------------------------------------
-- Organizations: the company using the CRM (PIXhub.lk).
-- Used for quotation headers / branding. Leads live in `contacts`.
-- ---------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  address text,
  phone text,
  email text,
  website text,
  tax_reg_no text,
  logo_url text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  phone text,
  role public.user_role not null default 'sales_executive',
  manager_id uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_not_own_manager check (manager_id is null or manager_id <> id)
);
create index profiles_manager_idx on public.profiles(manager_id);

-- ---------------------------------------------------------------------
-- Services & classification rules
-- ---------------------------------------------------------------------
create table public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category public.service_category not null,
  description text,
  base_price numeric(12,2) check (base_price is null or base_price >= 0),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Keyword → service rules used by Smart Classification. Matched as whole words
-- against "industry + company name". Editable by admins.
create table public.classification_rules (
  id uuid primary key default gen_random_uuid(),
  keyword text not null check (keyword ~ '^[a-z0-9 ]{2,40}$'),
  service_id uuid not null references public.services(id) on delete cascade,
  weight int not null check (weight between 1 and 100),
  reason text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (keyword, service_id)
);

-- ---------------------------------------------------------------------
-- Imports
-- ---------------------------------------------------------------------
create table public.lead_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  status public.import_status not null default 'processing',
  total_rows int not null default 0,
  inserted_rows int not null default 0,
  duplicate_rows int not null default 0,
  invalid_rows int not null default 0,
  invalid_phone_rows int not null default 0,
  column_mapping jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- ---------------------------------------------------------------------
-- Contacts = lead companies imported from Excel / added manually
-- ---------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (length(trim(company_name)) between 1 and 300),
  industry text,
  contact_person text,
  mobile_raw text,
  mobile text check (mobile is null or mobile ~ '^\+947[0-9]{8}$'),  -- E.164, format-valid only
  landline text,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  district text,
  city text,
  address text,
  website text,
  facebook_url text,
  notes text,

  -- Sales
  stage public.sales_stage not null default 'new',
  assigned_to uuid references public.profiles(id) on delete set null,
  estimated_value numeric(14,2) check (estimated_value is null or estimated_value >= 0),
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  won_at timestamptz,
  whatsapp_status public.outreach_status not null default 'none',

  -- Scoring (explainable)
  lead_score int not null default 0 check (lead_score between 0 and 100),
  score_breakdown jsonb not null default '[]'::jsonb,

  -- Verification (facts vs. assumptions). Only set when a human/authorized check happened.
  website_verified_at timestamptz,
  website_verified_source text,
  website_is_live boolean,
  facebook_verified_at timestamptz,
  facebook_verified_source text,
  facebook_is_active boolean,

  -- Privacy
  do_not_contact boolean not null default false,
  opted_out_at timestamptz,
  opt_out_reason text,

  import_id uuid references public.lead_imports(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Duplicate prevention: same mobile, or (no mobile) same normalised name + city
  dedupe_key text generated always as (
    coalesce(
      'm:' || mobile,
      'n:' || lower(regexp_replace(company_name, '[^a-zA-Z0-9]', '', 'g')) || '|' || lower(coalesce(city, ''))
    )
  ) stored
);
create unique index contacts_dedupe_key_uidx on public.contacts(dedupe_key);
create index contacts_assigned_idx on public.contacts(assigned_to);
create index contacts_stage_idx on public.contacts(stage);
create index contacts_district_idx on public.contacts(district);
create index contacts_industry_idx on public.contacts(industry);
create index contacts_score_idx on public.contacts(lead_score desc);
create index contacts_followup_idx on public.contacts(next_follow_up_at) where next_follow_up_at is not null;
create index contacts_created_idx on public.contacts(created_at desc);
create index contacts_import_idx on public.contacts(import_id);
create index contacts_name_trgm on public.contacts using gin (company_name gin_trgm_ops);
create index contacts_person_trgm on public.contacts using gin (contact_person gin_trgm_ops);

create table public.lead_service_recommendations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  confidence int not null check (confidence between 0 and 100),
  basis public.recommendation_basis not null,
  reason text not null,
  is_verified boolean not null default false,   -- true only when confirmed by staff
  source_url text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (contact_id, service_id)
);
create index lsr_service_idx on public.lead_service_recommendations(service_id);

-- ---------------------------------------------------------------------
-- Deals, activities
-- ---------------------------------------------------------------------
create table public.deals (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  title text not null,
  value numeric(14,2) not null default 0 check (value >= 0),
  probability int not null default 10 check (probability between 0 and 100),
  stage public.sales_stage not null default 'new',
  expected_close_date date,
  assigned_to uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deals_contact_idx on public.deals(contact_id);
create index deals_assigned_idx on public.deals(assigned_to);
create index deals_stage_idx on public.deals(stage);

-- Activity timeline for a contact (and optionally a specific deal)
create table public.deal_activities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  type text not null check (type in ('note','call','whatsapp','email','meeting','stage_change','assignment','import','system')),
  description text not null check (length(description) <= 5000),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index activities_contact_idx on public.deal_activities(contact_id, created_at desc);

-- ---------------------------------------------------------------------
-- Tasks & follow-ups
-- ---------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 300),
  description text,
  contact_id uuid references public.contacts(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  assigned_to uuid references public.profiles(id) on delete set null,
  priority public.task_priority not null default 'medium',
  status public.task_status not null default 'todo',
  due_at timestamptz,
  remind_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_assigned_due_idx on public.tasks(assigned_to, due_at) where status in ('todo','in_progress');

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  assigned_to uuid references public.profiles(id) on delete set null default auth.uid(),
  due_at timestamptz not null,
  channel text not null default 'whatsapp' check (channel in ('whatsapp','call','email','meeting','visit')),
  note text,
  status public.follow_up_status not null default 'pending',
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index follow_ups_due_idx on public.follow_ups(assigned_to, due_at) where status = 'pending';
create index follow_ups_contact_idx on public.follow_ups(contact_id);

-- ---------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------
create sequence public.quotation_number_seq start 1001;

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('PX-' || to_char(now(), 'YYYY') || '-' || nextval('public.quotation_number_seq')),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete set null,
  status public.quotation_status not null default 'draft',
  issue_date date not null default current_date,
  expiry_date date not null default (current_date + 30),
  currency text not null default 'LKR',
  subtotal numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  tax_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  notes text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotation_dates check (expiry_date >= issue_date)
);
create index quotations_contact_idx on public.quotations(contact_id);

create table public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  description text not null,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  line_total numeric(14,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)) stored,
  sort_order int not null default 0
);
create index quotation_items_q_idx on public.quotation_items(quotation_id);

-- ---------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('website','software','social_media','ecommerce','follow_up','meeting','general')),
  body text not null check (length(body) <= 4000),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.communication_logs (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel text not null default 'whatsapp' check (channel in ('whatsapp','call','email','sms','meeting')),
  direction text not null default 'outbound' check (direction in ('outbound','inbound')),
  status public.outreach_status not null,
  template_id uuid references public.message_templates(id) on delete set null,
  body text,
  -- how the status was established: manual confirmation by staff, or an authorized API webhook
  source text not null default 'manual' check (source in ('manual','whatsapp_cloud_api','system')),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index comm_logs_contact_idx on public.communication_logs(contact_id, created_at desc);

-- ---------------------------------------------------------------------
-- Notifications, audit, settings
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_record_idx on public.audit_logs(table_name, record_id);
create index audit_logs_created_idx on public.audit_logs(created_at desc);

create table public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);


-- >>> 20261113000002_functions_rls.sql
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


-- >>> 20261113000003_seed.sql
-- =====================================================================
-- PIXhub Sales CRM — reference data (services, classification rules,
-- message templates, settings). Safe to re-run.
-- =====================================================================

insert into public.organizations (name, legal_name, email, phone, website, address)
select 'PIXhub.lk', 'PIXhub.lk', 'info@pixhub.lk', '0712585960', 'https://pixhub.lk', 'Sri Lanka'
where not exists (select 1 from public.organizations);

-- PIXhub.lk packages and services (prices = "onwards" prices published on pixhub.lk;
-- NULL where the website lists the service without a price). Admins can edit in Settings.
insert into public.services (slug, name, category, description, base_price, sort_order) values
  ('starter-website',          'Starter Website',                'website',  'Up to 5 pages, mobile responsive, contact form & WhatsApp, basic SEO, free SSL · 5-10 days', 15000, 9),
  ('business-website',         'Business Website',               'website',  'Up to 10-15 pages, admin panel / CMS, blog, advanced SEO · 2-4 weeks', 75000, 10),
  ('corporate-website',        'Premium Corporate Website',      'website',  'Custom high-end UI, API & CRM integration, payment gateways, priority support · 4-12 weeks', 200000, 11),
  ('hotel-restaurant-website', 'Hotel & Restaurant Website',     'website',  'Menu, gallery, rooms and enquiry / WhatsApp integration', null, 12),
  ('ecommerce-store',          'E-commerce Platform',            'website',  'Online store with product catalogue and payment gateway', null, 13),
  ('booking-website',          'Booking Website',                'website',  'Online reservations / appointments', null, 14),
  ('landing-page',             'Landing Page',                   'website',  'Campaign landing page for lead capture', null, 15),
  ('basic-system',             'Basic Business System',          'software', 'Secure login, operations dashboard, user roles, CRUD, basic reports · 3-6 weeks', 80000, 20),
  ('pos-system',               'POS System',                     'software', 'Custom POS with invoicing & receipt sync (Advanced Business package) · 6-12 weeks', 180000, 21),
  ('billing-system',           'Billing Software',               'software', 'Invoice generation, receipts, payment tracking (Advanced Business package)', 180000, 22),
  ('crm-software',             'CRM System',                     'software', 'Multi-user CRM with charts, reports and notifications (Advanced Business package)', 180000, 23),
  ('inventory-management',     'Inventory Tracking System',      'software', 'Stock and inventory tracking', null, 24),
  ('order-management',         'Order Management',               'software', 'Orders, dispatch and delivery tracking', null, 25),
  ('erp-system',               'Enterprise ERP System',          'software', 'Fully tailored ERP, custom architecture, iOS/Android wrapper, SLAs · 12+ weeks', 500000, 26),
  ('workflow-automation',      'Business Workflow Automation',   'software', 'Custom workflow and logistics automations (Enterprise scope)', null, 27),
  ('custom-business-app',      'Custom Business Application',    'software', 'Tailor-made web / mobile application', null, 28),
  ('social-media-management',  'Social Starter (monthly)',       'marketing','6 posts + 2 reels/month, Facebook + Instagram, English captions, monthly report', 30000, 30),
  ('social-growth',            'Social Growth (monthly)',        'marketing','10 posts + 4 reels + 1 video/month, Sinhala + English captions, content calendar & ad setup', 50000, 31),
  ('social-premium',           'Social Premium (monthly)',       'marketing','15 posts + 6 reels + 2 videos/month, Facebook + Instagram + TikTok, strategy & analytics', 75000, 32),
  ('meta-ads',                 'Meta Advertising',               'marketing','Facebook / Instagram ad campaigns (ad budget billed separately)', null, 33),
  ('google-ads',               'Google Advertising',             'marketing','Search and display campaigns (ad budget billed separately)', null, 34),
  ('seo',                      'SEO',                            'marketing','Search engine optimisation', null, 35),
  ('branding',                 'Brand Identity & Design',        'marketing','Logo direction, visual identity and brand guidelines', null, 36),
  ('content-creation',         'Content Creation',               'marketing','Creative posts, reels and short videos', null, 37)
on conflict (slug) do nothing;

-- keyword, service slug, weight, reason
with r(keyword, slug, weight, reason) as (values
  -- Hospitality
  ('hotel','hotel-restaurant-website',85,'Hotels need a website for direct bookings'),
  ('hotel','booking-website',80,'Hotels benefit from online reservations'),
  ('hotel','meta-ads',60,'Hospitality sells well through visual ads'),
  ('resort','hotel-restaurant-website',85,'Resorts need a website for direct bookings'),
  ('resort','booking-website',80,'Resorts benefit from online reservations'),
  ('villa','booking-website',80,'Villas benefit from online reservations'),
  ('guest house','booking-website',80,'Guest houses benefit from online reservations'),
  ('guesthouse','booking-website',80,'Guest houses benefit from online reservations'),
  ('bungalow','booking-website',70,'Holiday bungalows benefit from online reservations'),
  ('hostel','booking-website',70,'Hostels benefit from online reservations'),
  ('inn','hotel-restaurant-website',65,'Inns need an online presence'),
  ('restaurant','hotel-restaurant-website',80,'Restaurants need an online menu and enquiry page'),
  ('restaurant','pos-system',75,'Restaurants need POS / KOT billing'),
  ('restaurant','social-media-management',70,'Food businesses grow through social media'),
  ('cafe','pos-system',70,'Cafes need POS billing'),
  ('cafe','social-media-management',75,'Cafes grow through social media'),
  ('bakery','pos-system',70,'Bakeries need POS billing'),
  ('bakery','social-media-management',65,'Bakeries grow through social media'),
  ('catering','landing-page',60,'Caterers capture event enquiries online'),
  ('catering','social-media-management',65,'Caterers grow through social media'),
  ('food','social-media-management',60,'Food businesses grow through social media'),
  -- Retail
  ('shop','pos-system',70,'Retail shops need POS billing'),
  ('shop','inventory-management',65,'Retail shops need stock control'),
  ('store','pos-system',70,'Stores need POS billing'),
  ('store','ecommerce-store',65,'Stores can sell online'),
  ('boutique','ecommerce-store',80,'Boutiques sell well online'),
  ('boutique','meta-ads',70,'Fashion sells through Meta ads'),
  ('fashion','ecommerce-store',80,'Fashion sells well online'),
  ('fashion','meta-ads',70,'Fashion sells through Meta ads'),
  ('clothing','ecommerce-store',75,'Clothing sells well online'),
  ('textile','ecommerce-store',70,'Textile retail can sell online'),
  ('textiles','ecommerce-store',70,'Textile retail can sell online'),
  ('cosmetic','ecommerce-store',75,'Cosmetics sell well online'),
  ('cosmetics','ecommerce-store',75,'Cosmetics sell well online'),
  ('jewellery','ecommerce-store',70,'Jewellery can be showcased online'),
  ('jewelry','ecommerce-store',70,'Jewellery can be showcased online'),
  ('electronics','ecommerce-store',70,'Electronics retail can sell online'),
  ('electronics','inventory-management',70,'Electronics retail needs serial / stock tracking'),
  ('mobile phone','ecommerce-store',65,'Phone shops can sell online'),
  ('mobile phones','pos-system',65,'Phone shops need POS billing'),
  ('hardware','inventory-management',75,'Hardware stores carry large inventories'),
  ('hardware','pos-system',70,'Hardware stores need POS billing'),
  ('supermarket','pos-system',85,'Supermarkets need POS billing'),
  ('supermarket','inventory-management',80,'Supermarkets need stock control'),
  ('grocery','pos-system',80,'Groceries need POS billing'),
  ('pharmacy','pos-system',80,'Pharmacies need POS billing'),
  ('pharmacy','inventory-management',80,'Pharmacies need batch / expiry tracking'),
  ('book shop','pos-system',70,'Book shops need POS billing'),
  ('bookshop','pos-system',70,'Book shops need POS billing'),
  -- Distribution / manufacturing
  ('wholesale','inventory-management',80,'Wholesalers need stock control'),
  ('wholesale','order-management',75,'Wholesalers handle many orders'),
  ('distributor','order-management',80,'Distributors handle many orders'),
  ('distributors','order-management',80,'Distributors handle many orders'),
  ('distribution','order-management',75,'Distribution needs order tracking'),
  ('manufacturer','erp-system',75,'Manufacturers benefit from ERP'),
  ('manufacturers','erp-system',75,'Manufacturers benefit from ERP'),
  ('manufacturing','erp-system',75,'Manufacturers benefit from ERP'),
  ('factory','erp-system',70,'Factories benefit from ERP'),
  ('industries','corporate-website',65,'Industrial firms need a corporate website'),
  ('exporter','corporate-website',75,'Exporters need a credible corporate website'),
  ('exporters','corporate-website',75,'Exporters need a credible corporate website'),
  ('export','seo',60,'Exporters need international search visibility'),
  ('logistics','order-management',70,'Logistics firms track orders and dispatch'),
  ('courier','order-management',70,'Couriers track orders and dispatch'),
  ('transport','corporate-website',55,'Transport firms need an online presence'),
  -- Services
  ('school','corporate-website',70,'Schools need an information website'),
  ('school','social-media-management',65,'Schools engage parents on social media'),
  ('institute','corporate-website',70,'Institutes need a course website'),
  ('institute','meta-ads',65,'Course enrolments come from Meta ads'),
  ('academy','meta-ads',65,'Course enrolments come from Meta ads'),
  ('education','corporate-website',65,'Education providers need a website'),
  ('tuition','social-media-management',65,'Tuition classes grow through social media'),
  ('campus','corporate-website',75,'Campuses need a full website'),
  ('hospital','corporate-website',70,'Hospitals need an information website'),
  ('hospital','booking-website',70,'Patients book appointments online'),
  ('clinic','booking-website',75,'Clinics benefit from online appointments'),
  ('medical','booking-website',65,'Medical services benefit from online appointments'),
  ('dental','booking-website',75,'Dental clinics benefit from online appointments'),
  ('channelling','booking-website',75,'Channelling centres need online booking'),
  ('laboratory','corporate-website',60,'Labs need an information website'),
  ('salon','booking-website',75,'Salons benefit from online appointments'),
  ('salon','social-media-management',75,'Salons grow through social media'),
  ('saloon','social-media-management',75,'Salons grow through social media'),
  ('spa','booking-website',75,'Spas benefit from online appointments'),
  ('beauty','social-media-management',75,'Beauty businesses grow through social media'),
  ('beauty','meta-ads',65,'Beauty services sell through Meta ads'),
  ('gym','social-media-management',70,'Gyms grow through social media'),
  ('fitness','social-media-management',70,'Fitness businesses grow through social media'),
  ('travel','booking-website',85,'Travel agencies need online booking'),
  ('travels','booking-website',85,'Travel agencies need online booking'),
  ('travel','seo',70,'Tourists search online for tours'),
  ('tours','booking-website',85,'Tour operators need online booking'),
  ('tours','google-ads',65,'Tour operators win bookings from Google ads'),
  ('construction','corporate-website',75,'Construction firms need a portfolio website'),
  ('constructions','corporate-website',75,'Construction firms need a portfolio website'),
  ('engineering','corporate-website',70,'Engineering firms need a corporate website'),
  ('builders','corporate-website',70,'Builders need a portfolio website'),
  ('architect','corporate-website',75,'Architects need a portfolio website'),
  ('architects','corporate-website',75,'Architects need a portfolio website'),
  ('interior','social-media-management',70,'Interior design sells visually on social media'),
  ('real estate','landing-page',70,'Property campaigns need landing pages'),
  ('real estate','meta-ads',75,'Property sells through Meta ads'),
  ('property','meta-ads',70,'Property sells through Meta ads'),
  ('land','landing-page',55,'Land sales campaigns need landing pages'),
  ('motor','inventory-management',60,'Auto businesses track spare parts'),
  ('motors','social-media-management',60,'Vehicle sales grow through social media'),
  ('auto','billing-system',60,'Auto services need job billing'),
  ('garage','billing-system',65,'Garages need job-card billing'),
  ('spare parts','inventory-management',75,'Spare parts dealers carry large inventories'),
  ('vehicle','social-media-management',55,'Vehicle sales grow through social media'),
  ('lawyer','corporate-website',70,'Law firms need a credible website'),
  ('lawyers','corporate-website',70,'Law firms need a credible website'),
  ('attorney','corporate-website',70,'Law firms need a credible website'),
  ('legal','seo',55,'Legal services are found via search'),
  ('accountant','corporate-website',65,'Accounting firms need a credible website'),
  ('accounting','corporate-website',65,'Accounting firms need a credible website'),
  ('audit','corporate-website',60,'Audit firms need a credible website'),
  ('consultant','corporate-website',65,'Consultants need a credible website'),
  ('consultants','corporate-website',65,'Consultants need a credible website'),
  ('consultancy','seo',55,'Consultancies are found via search'),
  ('insurance','crm-software',65,'Insurance agents manage many customers'),
  ('finance','crm-software',65,'Finance companies manage many customers'),
  ('leasing','crm-software',65,'Leasing companies manage many customers'),
  ('printing','branding',60,'Printing businesses work with branding'),
  ('printers','social-media-management',55,'Printers showcase work on social media'),
  ('advertising','social-media-management',55,'Agencies need a strong social presence'),
  ('event','social-media-management',75,'Event businesses sell visually'),
  ('events','social-media-management',75,'Event businesses sell visually'),
  ('wedding','social-media-management',75,'Wedding services sell visually'),
  ('photography','social-media-management',75,'Photographers sell visually'),
  ('studio','content-creation',60,'Studios benefit from content marketing'),
  ('florist','ecommerce-store',70,'Florists sell well online'),
  ('gift','ecommerce-store',70,'Gift shops sell well online'),
  ('furniture','ecommerce-store',70,'Furniture sells online with catalogues'),
  ('furniture','meta-ads',65,'Furniture sells through Meta ads'),
  ('tea','ecommerce-store',60,'Tea brands can sell online / export'),
  ('spices','ecommerce-store',60,'Spice brands can sell online / export'),
  ('ayurveda','ecommerce-store',65,'Ayurveda products sell online'),
  ('ayurvedic','ecommerce-store',65,'Ayurveda products sell online'),
  ('company','corporate-website',50,'Registered companies need a corporate website'),
  ('pvt ltd','corporate-website',50,'Registered companies need a corporate website'),
  ('enterprises','branding',45,'Growing enterprises benefit from branding'),
  -- PIXhub package fit (from pixhub.lk: Starter suits small businesses, salons and shops; Social Growth suits SMEs and retail)
  ('salon','starter-website',65,'Starter Website package is aimed at salons and small shops'),
  ('saloon','starter-website',65,'Starter Website package is aimed at salons and small shops'),
  ('barber','starter-website',60,'Starter Website package is aimed at small service businesses'),
  ('shop','starter-website',60,'Starter Website package is aimed at small shops'),
  ('boutique','starter-website',60,'Starter Website package is aimed at small shops'),
  ('cafe','starter-website',55,'Starter Website suits small food businesses'),
  ('bakery','starter-website',55,'Starter Website suits small food businesses'),
  ('tuition','starter-website',55,'Starter Website suits small education providers'),
  ('company','business-website',55,'Business Website package suits growing companies (CMS, blog, SEO)'),
  ('pvt ltd','business-website',55,'Business Website package suits growing companies (CMS, blog, SEO)'),
  ('consultants','business-website',55,'Business Website package suits professional firms'),
  ('supermarket','social-growth',55,'Social Growth package targets SMEs and retail stores'),
  ('store','social-growth',50,'Social Growth package targets SMEs and retail stores'),
  ('retail','social-growth',55,'Social Growth package targets SMEs and retail stores'),
  ('fashion','social-growth',55,'Fashion brands grow with regular reels and bilingual content'),
  ('logistics','workflow-automation',60,'Logistics firms benefit from workflow automation'),
  ('distributor','workflow-automation',50,'Distribution workflows can be automated'),
  ('factory','basic-system',55,'Operations tracking with a basic business system')
)
insert into public.classification_rules (keyword, service_id, weight, reason)
select r.keyword, s.id, r.weight, r.reason from r join public.services s on s.slug = r.slug
on conflict (keyword, service_id) do nothing;

-- WhatsApp templates. Placeholders: {{company}}, {{contact_person}}, {{services}}, {{city}}, {{sender}}
insert into public.message_templates (name, category, body)
select * from (values
  ('Website development', 'website',
   'Hello {{contact_person}}, this is {{sender}} from PIXhub.lk. We help businesses like {{company}} win more customers with a professional, mobile-friendly website with WhatsApp contact (packages from LKR 15,000). Would you be open to a quick chat? See our work at pixhub.lk. Reply STOP if you prefer not to hear from us.'),
  ('Software development', 'software',
   'Hello {{contact_person}}, this is {{sender}} from PIXhub.lk. We build {{services}} for businesses in {{city}} to save time on billing, stock and reporting. Could I share a short demo suited to {{company}}? Reply STOP to opt out.'),
  ('Social media management', 'social_media',
   'Hi {{contact_person}}, {{sender}} here from PIXhub.lk. We create monthly posts, reels and campaigns for Facebook & Instagram, with Sinhala and English captions (plans from LKR 30,000/month). I''d love to share a few ideas to grow {{company}}''s online audience. Interested? Reply STOP to opt out.'),
  ('E-commerce website', 'ecommerce',
   'Hello {{contact_person}}, this is {{sender}} from PIXhub.lk. We set up online stores with card payments and delivery so customers can order from {{company}} 24/7. Would you like to see some examples? Reply STOP to opt out.'),
  ('Follow-up', 'follow_up',
   'Hi {{contact_person}}, just following up on my earlier message about {{services}} for {{company}}. Is there a good time this week for a 10-minute call? – {{sender}}, PIXhub.lk'),
  ('Meeting confirmation', 'meeting',
   'Hello {{contact_person}}, thank you for your time. Confirming our meeting to discuss {{services}} for {{company}}. Please let me know if the time needs to change. – {{sender}}, PIXhub.lk')
) t(name, category, body)
where not exists (select 1 from public.message_templates);

insert into public.system_settings (key, value) values
  ('company', '{"currency":"LKR","timezone":"Asia/Colombo","default_tax_rate":0}'::jsonb),
  ('scoring', '{"qualified_threshold":60}'::jsonb),
  ('quotation', jsonb_build_object('default_notes',
    'Payment terms: 50% advance to start, 40% at design/development preview, 10% before launch and handover.' || chr(10) ||
    'Not included: domain registration, web hosting, paid templates/plugins, API keys, SMS gateways, payment gateway registration fees and advertising budgets (billed separately as needed).' || chr(10) ||
    'Campaign shoots, travel and product photography are quoted separately.'))
on conflict (key) do nothing;


-- >>> 20261114000004_phase2.sql
-- =====================================================================
-- PIXhub Sales CRM — Phase 2: deals, quotations workflow, tasks,
-- notifications & reminders, reporting
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------
alter table public.notifications
  add column kind text not null default 'general',
  add column send_email boolean not null default false,
  add column emailed_at timestamptz;
create index notifications_email_idx on public.notifications(created_at) where send_email and emailed_at is null;
create index notifications_unread_idx on public.notifications(user_id) where read_at is null;

alter table public.tasks add column reminded_at timestamptz;
alter table public.follow_ups add column reminded_at timestamptz;
create index tasks_remind_idx on public.tasks(remind_at) where reminded_at is null and status in ('todo','in_progress');
create index tasks_contact_idx on public.tasks(contact_id);
create index quotations_status_idx on public.quotations(status);
create index deals_service_idx on public.deals(service_id);

alter table public.quotations add column sent_at timestamptz, add column review_note text;

-- ---------------------------------------------------------------------
-- Task activity log
-- ---------------------------------------------------------------------
create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  type text not null check (type in ('created','status','assigned','due','priority','comment','edited')),
  description text not null check (length(description) <= 2000),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index task_events_task_idx on public.task_events(task_id, created_at desc);
alter table public.task_events enable row level security;
create policy task_events_select on public.task_events for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
create policy task_events_insert on public.task_events for insert to authenticated
  with check (created_by = auth.uid() and type = 'comment' and exists (select 1 from public.tasks t where t.id = task_id));

-- ---------------------------------------------------------------------
-- Notification helper (security definer: triggers notify other users)
-- ---------------------------------------------------------------------
create or replace function public.notify(
  p_user uuid, p_title text, p_body text, p_link text,
  p_kind text default 'general', p_email boolean default false, p_allow_self boolean default false
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  if not p_allow_self and p_user = auth.uid() then return; end if;
  if not exists (select 1 from public.profiles where id = p_user and is_active) then return; end if;
  insert into public.notifications (user_id, title, body, link, kind, send_email)
  values (p_user, left(p_title, 200), left(p_body, 1000), p_link, p_kind, p_email);
end $$;
revoke execute on function public.notify(uuid, text, text, text, text, boolean, boolean) from public, anon, authenticated;

-- Approvers for a user: their manager, else every active manager/admin
create or replace function public.approvers_for(p_user uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.id from public.profiles u join public.profiles m on m.id = u.manager_id
   where u.id = p_user and m.is_active and m.role in ('admin','sales_manager')
  union
  select id from public.profiles
   where is_active and role in ('admin','sales_manager')
     and not exists (select 1 from public.profiles u join public.profiles m on m.id = u.manager_id
                      where u.id = p_user and m.is_active and m.role in ('admin','sales_manager'))
$$;

-- ---------------------------------------------------------------------
-- Tasks: workflow, activity log, notifications
-- ---------------------------------------------------------------------
create or replace function public.tasks_before_write()
returns trigger language plpgsql as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then new.completed_at := now(); end if;
  if new.status <> 'done' then new.completed_at := null; end if;
  if tg_op = 'UPDATE' and new.remind_at is distinct from old.remind_at then new.reminded_at := null; end if;
  if tg_op = 'UPDATE' and new.due_at is distinct from old.due_at and new.remind_at is null then new.reminded_at := null; end if;
  return new;
end $$;
create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

create or replace function public.tasks_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce((select full_name from public.profiles where id = auth.uid()), 'System');
        who text;
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (task_id, type, description, created_by) values (new.id, 'created', 'Task created by ' || actor, auth.uid());
    perform public.notify(new.assigned_to, 'New task: ' || new.title, 'Assigned by ' || actor, '/tasks/' || new.id, 'task', true);
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.task_events (task_id, type, description, created_by)
    values (new.id, 'status', actor || ' changed status ' || old.status || ' → ' || new.status, auth.uid());
    if new.status = 'done' and new.created_by is distinct from new.assigned_to then
      perform public.notify(new.created_by, 'Task completed: ' || new.title, 'Completed by ' || actor, '/tasks/' || new.id, 'task');
    end if;
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    select full_name into who from public.profiles where id = new.assigned_to;
    insert into public.task_events (task_id, type, description, created_by)
    values (new.id, 'assigned', actor || ' assigned to ' || coalesce(who, 'nobody'), auth.uid());
    perform public.notify(new.assigned_to, 'Task assigned to you: ' || new.title, 'Assigned by ' || actor, '/tasks/' || new.id, 'task', true);
  end if;
  if new.due_at is distinct from old.due_at then
    insert into public.task_events (task_id, type, description, created_by)
    values (new.id, 'due', actor || ' rescheduled to ' ||
      coalesce(to_char(new.due_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI'), 'no due date'), auth.uid());
  end if;
  if new.priority is distinct from old.priority then
    insert into public.task_events (task_id, type, description, created_by)
    values (new.id, 'priority', actor || ' set priority ' || new.priority, auth.uid());
  end if;
  if new.title is distinct from old.title or new.description is distinct from old.description then
    insert into public.task_events (task_id, type, description, created_by) values (new.id, 'edited', actor || ' edited the task', auth.uid());
  end if;
  return null;
end $$;
create trigger tasks_after_write after insert or update on public.tasks
  for each row execute function public.tasks_after_write();
create trigger tasks_audit after delete on public.tasks for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------
-- Deals: probability by stage, closing, sync to lead, timeline, notifications
-- ---------------------------------------------------------------------
create or replace function public.stage_probability(s public.sales_stage)
returns int language sql immutable as $$
  select case s when 'new' then 10 when 'researching' then 10 when 'contacted' then 20 when 'interested' then 40
    when 'meeting_scheduled' then 50 when 'quotation_sent' then 60 when 'negotiation' then 75
    when 'won' then 100 else 0 end
$$;

create or replace function public.deals_before_write()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.probability is null or new.probability = 10 then new.probability := public.stage_probability(new.stage); end if;
  elsif new.stage is distinct from old.stage and new.probability = old.probability then
    new.probability := public.stage_probability(new.stage);
  end if;
  if new.stage in ('won','lost','not_interested') then
    new.closed_at := coalesce(case when tg_op = 'UPDATE' and old.stage = new.stage then old.closed_at end, now());
  else
    new.closed_at := null;
  end if;
  return new;
end $$;
create trigger deals_before_write before insert or update on public.deals
  for each row execute function public.deals_before_write();

create or replace function public.deals_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce((select full_name from public.profiles where id = auth.uid()), 'System');
        company text;
begin
  if tg_op = 'INSERT' then
    insert into public.deal_activities (contact_id, deal_id, type, description, created_by)
    values (new.contact_id, new.id, 'system', 'Deal created: ' || new.title || ' (LKR ' || to_char(new.value, 'FM999,999,999,990') || ')', auth.uid());
    perform public.notify(new.assigned_to, 'Deal assigned: ' || new.title, 'Created by ' || actor, '/leads/' || new.contact_id, 'deal');
    return null;
  end if;
  if new.stage is distinct from old.stage then
    insert into public.deal_activities (contact_id, deal_id, type, description, metadata, created_by)
    values (new.contact_id, new.id, 'stage_change', 'Deal "' || new.title || '" moved ' || replace(old.stage::text, '_', ' ') || ' → ' || replace(new.stage::text, '_', ' '),
            jsonb_build_object('from', old.stage, 'to', new.stage), auth.uid());
    -- Move the lead forward with its most advanced deal (never backwards automatically)
    update public.contacts c set stage = new.stage
     where c.id = new.contact_id
       and new.stage not in ('lost','not_interested')
       and array_position(enum_range(null::public.sales_stage), new.stage) > array_position(enum_range(null::public.sales_stage), c.stage)
       and c.stage not in ('won');
    if new.stage = 'won' then
      select company_name into company from public.contacts where id = new.contact_id;
      perform public.notify(m, '🎉 Deal won: ' || coalesce(company, ''), new.title || ' — LKR ' || to_char(new.value, 'FM999,999,999,990') || ' by ' || actor, '/leads/' || new.contact_id, 'deal')
        from public.approvers_for(coalesce(new.assigned_to, auth.uid())) m;
    end if;
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    perform public.notify(new.assigned_to, 'Deal assigned: ' || new.title, 'Assigned by ' || actor, '/leads/' || new.contact_id, 'deal');
  end if;
  return null;
end $$;
create trigger deals_after_write after insert or update on public.deals
  for each row execute function public.deals_after_write();

-- ---------------------------------------------------------------------
-- Quotations: totals, workflow guards, notifications, lead/deal sync
-- ---------------------------------------------------------------------
create or replace function public.quotations_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
declare sub numeric(14,2);
begin
  -- Financial fields are frozen once the quotation leaves draft / approval
  if tg_op = 'UPDATE' and old.status not in ('draft','pending_approval')
     and (new.discount_amount is distinct from old.discount_amount or new.tax_rate is distinct from old.tax_rate
          or new.contact_id is distinct from old.contact_id) then
    raise exception 'Approved or sent quotations cannot be edited. Revise it as a new draft.';
  end if;

  select coalesce(sum(line_total), 0) into sub from public.quotation_items where quotation_id = new.id;
  if new.discount_amount > sub then raise exception 'Discount cannot exceed the subtotal'; end if;
  new.subtotal := sub;
  new.tax_amount := round((sub - new.discount_amount) * new.tax_rate / 100, 2);
  new.total := sub - new.discount_amount + new.tax_amount;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'pending_approval' and old.status <> 'draft' then
      raise exception 'Only drafts can be submitted for approval';
    end if;
    if new.status = 'pending_approval' and sub <= 0 then raise exception 'Add at least one priced item first'; end if;
    if new.status = 'approved' then
      if old.status not in ('draft','pending_approval') then raise exception 'Only drafts or pending quotations can be approved'; end if;
      if sub <= 0 then raise exception 'Add at least one priced item first'; end if;
      new.approved_by := coalesce(auth.uid(), new.approved_by);
      new.approved_at := now();
    end if;
    if new.status = 'draft' then new.approved_by := null; new.approved_at := null; end if;
    if new.status = 'sent' then
      if old.status <> 'approved' then raise exception 'A quotation must be approved before it is sent'; end if;
      new.sent_at := now();
    end if;
    if new.status in ('accepted','rejected') and old.status not in ('sent','expired') then
      raise exception 'Only sent quotations can be accepted or rejected';
    end if;
  end if;
  return new;
end $$;
create trigger quotations_workflow before insert or update on public.quotations
  for each row execute function public.quotations_workflow();

create or replace function public.quotations_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor text := coalesce((select full_name from public.profiles where id = auth.uid()), 'System');
        company text;
begin
  if new.status is not distinct from old.status then return null; end if;
  select company_name into company from public.contacts where id = new.contact_id;

  insert into public.deal_activities (contact_id, deal_id, type, description, created_by)
  values (new.contact_id, new.deal_id, 'system', 'Quotation ' || new.number || ': ' || replace(old.status::text, '_', ' ') || ' → ' || replace(new.status::text, '_', ' ') || ' by ' || actor, auth.uid());

  if new.status = 'pending_approval' then
    perform public.notify(m, 'Approval needed: ' || new.number, coalesce(company, '') || ' — LKR ' || to_char(new.total, 'FM999,999,999,990.00') || ' from ' || actor, '/quotations/' || new.id, 'quotation', true)
      from public.approvers_for(new.created_by) m;
  elsif new.status = 'approved' then
    perform public.notify(new.created_by, 'Quotation approved: ' || new.number, coalesce(company, '') || ' — approved by ' || actor, '/quotations/' || new.id, 'quotation', true);
  elsif new.status = 'draft' and old.status = 'pending_approval' then
    perform public.notify(new.created_by, 'Changes requested: ' || new.number, coalesce(new.review_note, 'See quotation'), '/quotations/' || new.id, 'quotation', true);
  elsif new.status = 'sent' then
    update public.contacts set stage = 'quotation_sent'
     where id = new.contact_id and stage in ('new','researching','contacted','interested','meeting_scheduled');
    if new.deal_id is not null then
      update public.deals set stage = 'quotation_sent', value = case when value = 0 then new.total else value end
       where id = new.deal_id and stage in ('new','researching','contacted','interested','meeting_scheduled');
    end if;
  elsif new.status = 'accepted' then
    if new.deal_id is not null then
      update public.deals set stage = 'won', value = new.total where id = new.deal_id;
    else
      update public.contacts set stage = 'won', estimated_value = coalesce(estimated_value, new.total) where id = new.contact_id;
    end if;
  end if;
  return null;
end $$;
create trigger quotations_after_update after update on public.quotations
  for each row execute function public.quotations_after_update();

-- Recalculate totals whenever items change
create or replace function public.quotation_items_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.quotations set updated_at = now() where id = coalesce(new.quotation_id, old.quotation_id);
  return null;
end $$;
create trigger quotation_items_touch after insert or update or delete on public.quotation_items
  for each row execute function public.quotation_items_touch();

-- Items can only change while the quotation is editable
drop policy qitems_all on public.quotation_items;
create policy qitems_select on public.quotation_items for select to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id));
create policy qitems_write on public.quotation_items for all to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id and q.status in ('draft','pending_approval')))
  with check (exists (select 1 from public.quotations q where q.id = quotation_id and q.status in ('draft','pending_approval')));

-- Atomic create / edit of a quotation and its items (runs as the caller → RLS applies)
create or replace function public.save_quotation(
  p_id uuid, p_contact uuid, p_deal uuid, p_issue date, p_expiry date,
  p_discount numeric, p_tax numeric, p_notes text, p_items jsonb
) returns uuid language plpgsql security invoker set search_path = public as $$
declare qid uuid := p_id; st public.quotation_status;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item'; end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'A quotation can have at most 50 items'; end if;
  if qid is null then
    insert into public.quotations (contact_id, deal_id, issue_date, expiry_date, notes, created_by)
    values (p_contact, p_deal, p_issue, p_expiry, left(p_notes, 4000), auth.uid())
    returning id into qid;
  else
    select status into st from public.quotations where id = qid;
    if st is null then raise exception 'Quotation not found'; end if;
    if st <> 'draft' then raise exception 'Only draft quotations can be edited (withdraw it from approval first)'; end if;
    update public.quotations set discount_amount = 0, deal_id = p_deal, issue_date = p_issue,
           expiry_date = p_expiry, notes = left(p_notes, 4000)
     where id = qid;
    delete from public.quotation_items where quotation_id = qid;
  end if;

  insert into public.quotation_items (quotation_id, service_id, description, quantity, unit_price, discount_pct, sort_order)
  select qid, nullif(i->>'service_id', '')::uuid, left(trim(i->>'description'), 500),
         (i->>'quantity')::numeric, (i->>'unit_price')::numeric, coalesce(nullif(i->>'discount_pct', '')::numeric, 0), ord
    from jsonb_array_elements(p_items) with ordinality as t(i, ord);

  update public.quotations set discount_amount = coalesce(p_discount, 0), tax_rate = coalesce(p_tax, 0) where id = qid;
  return qid;
end $$;

-- ---------------------------------------------------------------------
-- Scheduled jobs (run by pg_cron — see supabase/cron.sql — and lazily by the app)
-- ---------------------------------------------------------------------
create or replace function public.expire_quotations()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.quotations set status = 'expired'
   where status in ('approved','sent') and expiry_date < (now() at time zone 'Asia/Colombo')::date;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.create_due_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare n1 int; n2 int;
begin
  with due as (
    update public.tasks set reminded_at = now()
     where reminded_at is null and status in ('todo','in_progress') and assigned_to is not null
       and (remind_at <= now() or (remind_at is null and due_at <= now() + interval '1 hour'))
    returning id, title, assigned_to, due_at
  )
  insert into public.notifications (user_id, title, body, link, kind, send_email)
  select assigned_to, 'Reminder: ' || title,
         case when due_at is null then 'Task reminder' else 'Due ' || to_char(due_at at time zone 'Asia/Colombo', 'DD Mon HH24:MI') end,
         '/tasks/' || id, 'reminder', true
    from due;
  get diagnostics n1 = row_count;

  with due as (
    update public.follow_ups f set reminded_at = now()
     where reminded_at is null and status = 'pending' and assigned_to is not null and due_at <= now() + interval '1 hour'
    returning f.id, f.contact_id, f.assigned_to, f.due_at, f.channel
  )
  insert into public.notifications (user_id, title, body, link, kind, send_email)
  select d.assigned_to, 'Follow-up due: ' || c.company_name,
         initcap(d.channel) || ' · ' || to_char(d.due_at at time zone 'Asia/Colombo', 'DD Mon HH24:MI'),
         '/leads/' || d.contact_id, 'reminder', true
    from due d join public.contacts c on c.id = d.contact_id;
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

create or replace function public.run_housekeeping()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('reminders', public.create_due_reminders(), 'expired', public.expire_quotations())
$$;

-- Mark-all-read helper
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns int language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Reporting: revenue counts won deals, plus won leads that have no deals
-- ---------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb language sql stable security invoker set search_path = public as $$
  with c as (select * from public.contacts),
  d as (select * from public.deals),
  nodeal as (select * from c where not exists (select 1 from d where d.contact_id = c.id)),
  today as (select (now() at time zone 'Asia/Colombo')::date as d)
  select jsonb_build_object(
    'total_leads', (select count(*) from c),
    'new_leads_7d', (select count(*) from c where created_at > now() - interval '7 days'),
    'new_stage', (select count(*) from c where stage = 'new'),
    'qualified', (select count(*) from c where lead_score >= 60 and stage not in ('lost', 'not_interested')),
    'contacted', (select count(*) from c where stage not in ('new', 'researching')),
    'interested', (select count(*) from c where stage in ('interested', 'meeting_scheduled', 'quotation_sent', 'negotiation')),
    'quotations_sent', (select count(*) from public.quotations where status in ('sent','accepted','rejected')),
    'won', (select count(*) from c where stage = 'won'),
    'lost', (select count(*) from c where stage in ('lost', 'not_interested')),
    'revenue', (select coalesce(sum(value), 0) from d where stage = 'won')
             + (select coalesce(sum(estimated_value), 0) from nodeal where stage = 'won'),
    'pipeline_value', (select coalesce(sum(value), 0) from d where stage not in ('won','lost','not_interested'))
             + (select coalesce(sum(estimated_value), 0) from nodeal
                 where stage in ('interested', 'meeting_scheduled', 'quotation_sent', 'negotiation')),
    'weighted_pipeline', (select coalesce(sum(value * probability / 100.0), 0) from d where stage not in ('won','lost','not_interested')),
    'open_deals', (select count(*) from d where stage not in ('won','lost','not_interested')),
    'valid_mobiles', (select count(*) from c where mobile is not null),
    'do_not_contact', (select count(*) from c where do_not_contact),
    'overdue_follow_ups', (select count(*) from public.follow_ups where status = 'pending' and due_at < now()),
    'follow_ups_today', (select count(*) from public.follow_ups, today
                          where status = 'pending' and (due_at at time zone 'Asia/Colombo')::date = today.d),
    'meetings_upcoming', (select count(*) from public.follow_ups where status = 'pending' and channel = 'meeting' and due_at >= now()),
    'pending_quotations', (select count(*) from public.quotations where status in ('draft', 'pending_approval', 'approved', 'sent')),
    'quotations_awaiting_approval', (select count(*) from public.quotations where status = 'pending_approval'),
    'tasks_due_today', (select count(*) from public.tasks, today where status in ('todo','in_progress')
                         and (due_at at time zone 'Asia/Colombo')::date = today.d),
    'tasks_overdue', (select count(*) from public.tasks where status in ('todo','in_progress') and due_at < now())
  )
$$;

create or replace function public.dashboard_breakdowns()
returns jsonb language sql stable security invoker set search_path = public as $$
  with nodeal as (select * from public.contacts c where not exists (select 1 from public.deals d where d.contact_id = c.id))
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
               (select coalesce(sum(d.value), 0) from public.deals d where d.stage = 'won' and d.assigned_to is not distinct from c.assigned_to)
                 + coalesce(sum(c.estimated_value) filter (where c.stage = 'won' and not exists (select 1 from public.deals d where d.contact_id = c.id)), 0) as revenue
          from public.contacts c
          left join public.profiles p on p.id = c.assigned_to
         group by c.assigned_to, p.full_name order by leads desc limit 15) x),
    'monthly', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
        select to_char(m, 'YYYY-MM') as month,
               (select count(*) from public.contacts c
                 where date_trunc('month', c.created_at at time zone 'Asia/Colombo') = m) as new_leads,
               (select count(*) from public.contacts c
                 where date_trunc('month', c.won_at at time zone 'Asia/Colombo') = m) as won,
               (select coalesce(sum(value), 0) from public.deals d
                 where d.stage = 'won' and date_trunc('month', d.closed_at at time zone 'Asia/Colombo') = m)
               + (select coalesce(sum(estimated_value), 0) from nodeal c
                 where date_trunc('month', c.won_at at time zone 'Asia/Colombo') = m) as revenue
          from generate_series(
                 date_trunc('month', now() at time zone 'Asia/Colombo') - interval '11 months',
                 date_trunc('month', now() at time zone 'Asia/Colombo'),
                 interval '1 month') m) x),
    'revenue_by_service', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(s.name, 'Unspecified') as name, sum(d.value) as value
          from public.deals d left join public.services s on s.id = d.service_id
         where d.stage = 'won' group by 1 order by 2 desc limit 12) x),
    'deals_by_stage', (select coalesce(jsonb_agg(x), '[]') from (
        select stage::text as name, count(*) as count, coalesce(sum(value), 0) as value
          from public.deals group by stage) x),
    'quotations_by_status', (select coalesce(jsonb_agg(x), '[]') from (
        select status::text as name, count(*) as value, coalesce(sum(total), 0) as amount
          from public.quotations group by status) x)
  )
$$;


-- >>> 20261114000005_phase3.sql
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


-- >>> 20261115000006_email_campaigns.sql
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

