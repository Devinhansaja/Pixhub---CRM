-- =====================================================================
-- Removes ALL demo data created by seed-demo.sql:
--   * the 80 demo businesses and their deals, quotations, tasks,
--     follow-ups, messages and activity
--   * the 4 @pixhub-demo.test logins (and their notifications / AI usage)
--   * the sample service prices the demo filled in (only where the price
--     is still exactly the demo value — prices you changed are kept)
--   * audit-log entries written by the demo users / demo seeding
-- Your real data, services, rules, templates and settings are kept.
-- Cannot be undone.
-- =====================================================================
begin;

delete from public.tasks
 where created_by in (select id from public.profiles where email like '%@pixhub-demo.test')
    or contact_id in (select id from public.contacts where import_id = '00000000-0000-4000-b000-000000000001');

-- cascades to deals, quotations (+ items), follow-ups, messages, activity, recommendations, enrichment
delete from public.contacts where import_id = '00000000-0000-4000-b000-000000000001';
delete from public.lead_imports where id = '00000000-0000-4000-b000-000000000001';

-- Sample prices added by the demo for services pixhub.lk lists without a price
update public.services s set base_price = null
  from (values ('hotel-restaurant-website', 120000), ('ecommerce-store', 180000), ('booking-website', 150000),
               ('landing-page', 35000), ('inventory-management', 110000), ('order-management', 140000),
               ('custom-business-app', 400000), ('meta-ads', 25000), ('google-ads', 25000), ('seo', 40000),
               ('branding', 60000), ('content-creation', 20000)) as d(slug, price)
 where s.slug = d.slug and s.base_price = d.price;

-- Audit entries from demo users, and from the seeding itself (run in the SQL editor: no user)
delete from public.audit_logs
 where actor_id in ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002',
                    '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000004')
    or (actor_id is null and table_name in ('contacts', 'deals', 'quotations', 'profiles')
        and (coalesce(new_data, old_data)->>'import_id' = '00000000-0000-4000-b000-000000000001'
             or coalesce(new_data, old_data)->>'email' like '%@pixhub-demo.test'
             or (coalesce(new_data, old_data)->>'contact_id' is not null
                 and not exists (select 1 from public.contacts c where c.id = (coalesce(new_data, old_data)->>'contact_id')::uuid))));

-- Demo logins (cascades to profiles, notifications, AI usage)
delete from auth.users where email like '%@pixhub-demo.test';

commit;

select 'Demo data removed' as result,
       (select count(*) from public.contacts) as leads_left,
       (select count(*) from public.profiles) as users_left,
       (select count(*) from public.services) as services_kept;
