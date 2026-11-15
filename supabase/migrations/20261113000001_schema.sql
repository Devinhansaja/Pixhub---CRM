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
