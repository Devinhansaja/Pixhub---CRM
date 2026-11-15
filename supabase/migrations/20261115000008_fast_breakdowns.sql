-- =====================================================================
-- Faster dashboard_breakdowns: with ~17k leads the old version re-scanned
-- contacts (with RLS checks) ~30 times and hit the 8s statement timeout.
-- This version reads the visible contacts and deals ONCE (materialized CTEs)
-- and derives every breakdown from them. Same output shape as before.
-- =====================================================================
create or replace function public.dashboard_breakdowns()
returns jsonb language sql stable security invoker set search_path = public as $$
  with c as materialized (
    select id, stage, industry, district, assigned_to, created_at, won_at, estimated_value
      from public.contacts
  ),
  d as materialized (
    select contact_id, service_id, stage, value, assigned_to, closed_at from public.deals
  ),
  has_deal as materialized (select distinct contact_id from d),
  nodeal as materialized (
    select c.* from c where not exists (select 1 from has_deal h where h.contact_id = c.id)
  ),
  months as (
    select generate_series(
      date_trunc('month', now() at time zone 'Asia/Colombo') - interval '11 months',
      date_trunc('month', now() at time zone 'Asia/Colombo'),
      interval '1 month') as m
  ),
  owner_deal_rev as (
    select assigned_to, sum(value) as rev from d where stage = 'won' group by assigned_to
  ),
  owners as (
    select c.assigned_to,
           count(*) as leads,
           count(*) filter (where c.stage not in ('new', 'researching')) as contacted,
           count(*) filter (where c.stage = 'won') as won
      from c group by c.assigned_to
  ),
  owner_nodeal_rev as (
    select assigned_to, sum(estimated_value) as rev from nodeal where stage = 'won' group by assigned_to
  )
  select jsonb_build_object(
    'by_stage', (select coalesce(jsonb_agg(x), '[]') from (
        select stage::text as name, count(*) as value from c group by stage) x),
    'by_industry', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(nullif(trim(industry), ''), 'Unknown') as name, count(*) as value
          from c group by 1 order by 2 desc limit 10) x),
    'by_district', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(nullif(trim(district), ''), 'Unknown') as name, count(*) as value
          from c group by 1 order by 2 desc limit 15) x),
    'by_service', (select coalesce(jsonb_agg(x), '[]') from (
        select s.name, count(*) as value
          from public.lead_service_recommendations r
          join c on c.id = r.contact_id
          join public.services s on s.id = r.service_id
         group by s.name order by 2 desc limit 12) x),
    'by_owner', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(p.full_name, 'Unassigned') as name, o.leads, o.contacted, o.won,
               coalesce(dr.rev, 0) + coalesce(nr.rev, 0) as revenue
          from owners o
          left join public.profiles p on p.id = o.assigned_to
          left join owner_deal_rev dr on dr.assigned_to is not distinct from o.assigned_to
          left join owner_nodeal_rev nr on nr.assigned_to is not distinct from o.assigned_to
         order by o.leads desc limit 15) x),
    'monthly', (select coalesce(jsonb_agg(x order by x.month), '[]') from (
        select to_char(months.m, 'YYYY-MM') as month,
               coalesce(nl.n, 0) as new_leads,
               coalesce(w.n, 0) as won,
               coalesce(dv.v, 0) + coalesce(ev.v, 0) as revenue
          from months
          left join (select date_trunc('month', created_at at time zone 'Asia/Colombo') as m, count(*) as n from c group by 1) nl on nl.m = months.m
          left join (select date_trunc('month', won_at at time zone 'Asia/Colombo') as m, count(*) as n from c where won_at is not null group by 1) w on w.m = months.m
          left join (select date_trunc('month', closed_at at time zone 'Asia/Colombo') as m, sum(value) as v from d where stage = 'won' group by 1) dv on dv.m = months.m
          left join (select date_trunc('month', won_at at time zone 'Asia/Colombo') as m, sum(estimated_value) as v from nodeal where won_at is not null group by 1) ev on ev.m = months.m
       ) x),
    'revenue_by_service', (select coalesce(jsonb_agg(x), '[]') from (
        select coalesce(s.name, 'Unspecified') as name, sum(d.value) as value
          from d left join public.services s on s.id = d.service_id
         where d.stage = 'won' group by 1 order by 2 desc limit 12) x),
    'deals_by_stage', (select coalesce(jsonb_agg(x), '[]') from (
        select stage::text as name, count(*) as count, coalesce(sum(value), 0) as value
          from d group by stage) x),
    'quotations_by_status', (select coalesce(jsonb_agg(x), '[]') from (
        select status::text as name, count(*) as value, coalesce(sum(total), 0) as amount
          from public.quotations group by status) x)
  )
$$;
