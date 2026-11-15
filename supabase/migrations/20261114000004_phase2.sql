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
