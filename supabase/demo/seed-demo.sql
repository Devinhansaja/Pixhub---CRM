-- =====================================================================
-- PIXhub Sales CRM — DEMO DATA for testing (NOT for production)
--
-- Run in the Supabase SQL Editor of a TEST project, after all migrations.
-- Creates 4 demo logins and ~80 fictional businesses with deals, tasks,
-- follow-ups and quotations so every page has something to show.
-- Remove everything again with supabase/demo/remove-demo.sql.
--
-- Demo logins (all use the same password):
--   admin@pixhub-demo.test     — Admin
--   manager@pixhub-demo.test   — Sales Manager
--   sales1@pixhub-demo.test    — Sales Executive (in the manager's team)
--   sales2@pixhub-demo.test    — Sales Executive (in the manager's team)
--   Password: PixhubDemo#2026
--
-- Demo businesses have NO phone numbers on purpose (any real-looking number
-- could belong to a real person). To test WhatsApp, edit a demo lead and
-- add YOUR OWN mobile number.
-- Safe to re-run: it resets the demo businesses to a fresh state.
-- =====================================================================

-- Reset previous demo businesses (keeps demo logins)
delete from public.tasks where contact_id in (select id from public.contacts where import_id = '00000000-0000-4000-b000-000000000001');
delete from public.contacts where import_id = '00000000-0000-4000-b000-000000000001';

do $$
declare
  pw text := 'PixhubDemo#2026';
  u record;
begin
  if exists (select 1 from auth.users where email like '%@pixhub-demo.test') then
    raise notice 'Demo users already exist — skipping user creation';
    return;
  end if;
  for u in select * from (values
    ('00000000-0000-4000-a000-000000000001'::uuid, 'admin@pixhub-demo.test',   'Demo Admin'),
    ('00000000-0000-4000-a000-000000000002'::uuid, 'manager@pixhub-demo.test', 'Dilini Manager'),
    ('00000000-0000-4000-a000-000000000003'::uuid, 'sales1@pixhub-demo.test',  'Kasun Sales'),
    ('00000000-0000-4000-a000-000000000004'::uuid, 'sales2@pixhub-demo.test',  'Nimali Sales')
  ) as t(id, email, name)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
            extensions.crypt(pw, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.name), now(), now(),
            '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
            jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', now(), now(), now());
  end loop;
end $$;

-- Roles and team (the first user ever created is admin automatically; set all explicitly)
update public.profiles set role = 'admin' where id = '00000000-0000-4000-a000-000000000001';
update public.profiles set role = 'sales_manager' where id = '00000000-0000-4000-a000-000000000002';
update public.profiles set role = 'sales_executive', manager_id = '00000000-0000-4000-a000-000000000002'
 where id in ('00000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000004');

-- Service package prices (only where not set yet)
update public.services s set base_price = p.price from (values
  ('corporate-website', 85000), ('hotel-restaurant-website', 120000), ('ecommerce-store', 180000),
  ('booking-website', 150000), ('landing-page', 35000), ('pos-system', 95000), ('inventory-management', 110000),
  ('billing-system', 75000), ('crm-software', 250000), ('erp-system', 650000), ('order-management', 140000),
  ('custom-business-app', 400000), ('social-media-management', 30000), ('meta-ads', 25000), ('google-ads', 25000),
  ('seo', 40000), ('branding', 60000), ('content-creation', 20000)
) as p(slug, price) where s.slug = p.slug and s.base_price is null;

update public.organizations set address = coalesce(address, 'Colombo, Sri Lanka');

-- ---------------------------------------------------------------------
-- Fictional businesses (tagged with a "Demo data" import so they can be removed)
-- ---------------------------------------------------------------------
insert into public.lead_imports (id, file_name, status, total_rows, inserted_rows, created_by, finished_at)
values ('00000000-0000-4000-b000-000000000001', 'Demo data (sample)', 'completed', 80, 80, '00000000-0000-4000-a000-000000000001', now())
on conflict (id) do nothing;

with names(i, name, industry) as (values
  (1,'Lakeside Breeze Hotel','Hotel'),(2,'Spice Route Restaurant','Restaurant'),(3,'Ceylon Leaf Tea Boutique','Tea shop'),
  (4,'Golden Palm Resort','Resort'),(5,'Island Fresh Supermarket','Supermarket'),(6,'Kandy Hills Guest House','Guest house'),
  (7,'Marine Drive Pharmacy','Pharmacy'),(8,'Silk & Thread Fashion','Fashion boutique'),(9,'TechZone Electronics','Electronics shop'),
  (10,'Ruhuna Hardware Stores','Hardware'),(11,'Sunrise Bakery & Cafe','Bakery'),(12,'Galle Fort Tours','Travel agency'),
  (13,'Bright Minds Academy','Education institute'),(14,'City Dental Clinic','Dental clinic'),(15,'Glow Beauty Salon','Beauty salon'),
  (16,'Lanka Builders Pvt Ltd','Construction'),(17,'Coconut Grove Villa','Villa'),(18,'Spicy Bites Catering','Catering'),
  (19,'Royal Jewellers','Jewellery'),(20,'GreenLeaf Ayurveda','Ayurvedic products'),(21,'Metro Motors','Motor vehicle sales'),
  (22,'Pearl Bay Restaurant','Restaurant'),(23,'Highland Fitness Gym','Gym'),(24,'Nuwara Mist Bungalow','Bungalow'),
  (25,'Prime Property Lanka','Real estate'),(26,'SwiftLink Courier','Courier'),(27,'Colombo Book Shop','Book shop'),
  (28,'Unity Textiles','Textiles wholesale'),(29,'BlueOcean Exporters','Exporters'),(30,'Rainbow Events','Event planning'),
  (31,'Lotus Photography Studio','Photography'),(32,'Vision Opticals','Optical shop'),(33,'Hill Country Spices','Spices'),
  (34,'Smart Auto Garage','Garage'),(35,'Cinnamon Cafe','Cafe'),(36,'Elite Interior Designers','Interior design'),
  (37,'Trinco Diving Center','Tours'),(38,'Matara Medical Centre','Medical centre'),(39,'Fresh Mart Grocery','Grocery'),
  (40,'Ocean View Hostel','Hostel'),(41,'Kids Planet Toys','Toy shop'),(42,'PrintPro Printers','Printing'),
  (43,'Serene Spa & Wellness','Spa'),(44,'AutoParts Lanka','Spare parts'),(45,'Lakmal Furniture','Furniture'),
  (46,'Sigiri Rock Inn','Hotel'),(47,'Taste of Jaffna','Restaurant'),(48,'Peak Accountants','Accounting firm'),
  (49,'Nexus Insurance Agency','Insurance'),(50,'Urban Threads Clothing','Clothing store'),(51,'Batik Craft House','Handicrafts'),
  (52,'Royal Florists','Florist'),(53,'Bay Leaf Distributors','Distributor'),(54,'SafeHome Security','Security services'),
  (55,'Anura Engineering','Engineering'),(56,'Little Stars Preschool','School'),(57,'Mount Lavinia Bistro','Restaurant'),
  (58,'Coral Reef Hotel','Hotel'),(59,'Wellawatte Mobile Center','Mobile phone shop'),(60,'Sapphire Gems','Jewellery'),
  (61,'EcoClean Laundry','Laundry'),(62,'Arugam Surf Camp','Tours'),(63,'Leisure Travels','Travel agency'),
  (64,'Sunshine Pharmacy','Pharmacy'),(65,'Kurunegala Rice Mill','Manufacturing'),(66,'Velvet Cakes','Bakery'),
  (67,'Ella Rock View Homestay','Guest house'),(68,'Infinity Gym','Fitness'),(69,'MegaBuild Hardware','Hardware'),
  (70,'Negombo Seafood Grill','Restaurant'),(71,'LegalEase Lawyers','Law firm'),(72,'Ceylon Coir Exporters','Exporters'),
  (73,'StyleUp Barber Shop','Barber'),(74,'Polonnaruwa Heritage Hotel','Hotel'),(75,'Q-Mart Wholesale','Wholesale'),
  (76,'BrightPath Tuition','Tuition'),(77,'Kandy Gold House','Jewellery'),(78,'FreshFarm Dairy','Food manufacturing'),
  (79,'Smile Kids Dental','Dental clinic'),(80,'Vertex IT Solutions','IT company')
),
places(n, city, district) as (values
  (0,'Colombo 03','Colombo'),(1,'Kandy','Kandy'),(2,'Galle','Galle'),(3,'Negombo','Gampaha'),(4,'Matara','Matara'),
  (5,'Kurunegala','Kurunegala'),(6,'Nuwara Eliya','Nuwara Eliya'),(7,'Jaffna','Jaffna'),(8,'Dehiwala','Colombo'),(9,'Trincomalee','Trincomalee')
)
insert into public.contacts (company_name, industry, contact_person, email, city, district, website, facebook_url, notes,
                             stage, assigned_to, estimated_value, import_id, created_by, created_at)
select n.name, n.industry,
       (array['Mr. Perera','Ms. Fernando','Mr. Silva','Mrs. Jayasinghe','Mr. Bandara','Ms. Wickramasinghe','Mr. Rajapaksha','Mrs. Dissanayake'])[1 + n.i % 8],
       case when n.i % 3 = 0 then 'info@' || lower(regexp_replace(n.name, '[^a-zA-Z]', '', 'g')) || '.example' end,
       p.city, p.district,
       case when n.i % 4 = 0 then 'https://' || lower(regexp_replace(n.name, '[^a-zA-Z]', '', 'g')) || '.example' end,
       case when n.i % 5 = 0 then 'https://www.facebook.com/' || lower(regexp_replace(n.name, '[^a-zA-Z]', '', 'g')) end,
       'Demo record — fictional business',
       (array['new','new','new','researching','contacted','contacted','interested','meeting_scheduled','quotation_sent','negotiation','won','lost','not_interested','new'])[1 + n.i % 14]::public.sales_stage,
       case when n.i % 5 in (0, 1) then '00000000-0000-4000-a000-000000000003'::uuid
            when n.i % 5 in (2, 3) then '00000000-0000-4000-a000-000000000004'::uuid end,
       case when n.i % 14 between 6 and 10 then (array[85000, 120000, 180000, 95000, 250000])[1 + n.i % 5] end,
       '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001',
       now() - ((80 - n.i) * interval '4 days')
  from names n join places p on p.n = n.i % 10
on conflict (dedupe_key) do nothing;

-- Classify + score all demo leads
select public.classify_contacts(array(select id from public.contacts where import_id = '00000000-0000-4000-b000-000000000001'));

-- Outreach history (manual, clearly demo)
insert into public.communication_logs (contact_id, channel, direction, status, body, source, created_by, created_at)
select c.id, 'whatsapp', 'outbound', 'contacted', 'Demo message', 'manual', c.assigned_to, c.created_at + interval '1 day'
  from public.contacts c
 where c.import_id = '00000000-0000-4000-b000-000000000001' and c.stage not in ('new','researching') and c.assigned_to is not null;
insert into public.communication_logs (contact_id, channel, direction, status, body, source, created_by, created_at)
select c.id, 'whatsapp', 'inbound', 'replied', 'Demo reply: please send details', 'manual', c.assigned_to, c.created_at + interval '2 days'
  from public.contacts c
 where c.import_id = '00000000-0000-4000-b000-000000000001' and c.stage in ('interested','meeting_scheduled','quotation_sent','negotiation','won') and c.assigned_to is not null;

-- Deals for leads that are interested or further
insert into public.deals (contact_id, service_id, title, value, stage, assigned_to, expected_close_date, created_by)
select c.id, r.service_id, s.name || ' for ' || c.company_name, coalesce(c.estimated_value, s.base_price, 100000),
       c.stage, c.assigned_to, current_date + (c.lead_score % 45), coalesce(c.assigned_to, '00000000-0000-4000-a000-000000000002')
  from public.contacts c
  join lateral (select service_id from public.lead_service_recommendations where contact_id = c.id order by confidence desc limit 1) r on true
  join public.services s on s.id = r.service_id
 where c.import_id = '00000000-0000-4000-b000-000000000001'
   and c.stage in ('interested','meeting_scheduled','quotation_sent','negotiation','won','lost');

-- Follow-ups (some overdue, some today, some upcoming)
insert into public.follow_ups (contact_id, assigned_to, due_at, channel, note, created_by)
select c.id, c.assigned_to,
       now() + ((row_number() over (order by c.company_name)) % 7 - 2) * interval '1 day' + interval '2 hours',
       (array['whatsapp','call','meeting'])[1 + (row_number() over (order by c.company_name))::int % 3],
       'Demo follow-up', c.assigned_to
  from public.contacts c
 where c.import_id = '00000000-0000-4000-b000-000000000001' and c.assigned_to is not null
   and c.stage in ('contacted','interested','meeting_scheduled','quotation_sent');

-- Tasks
insert into public.tasks (title, description, contact_id, assigned_to, priority, status, due_at, created_by)
select t.title, 'Demo task', c.id, c.assigned_to, t.priority::public.task_priority, t.status::public.task_status,
       now() + t.days * interval '1 day', '00000000-0000-4000-a000-000000000002'
  from (select id, assigned_to, row_number() over (order by company_name) rn from public.contacts
         where import_id = '00000000-0000-4000-b000-000000000001' and assigned_to is not null) c
  join (values (1, 'Prepare website mock-up', 'high', 'in_progress', 1), (2, 'Call owner about POS demo', 'urgent', 'todo', -1),
               (3, 'Send portfolio PDF', 'medium', 'todo', 0), (4, 'Check competitor pages', 'low', 'done', -3),
               (5, 'Book meeting room for demo', 'medium', 'todo', 3)) as t(rn, title, priority, status, days)
    on t.rn = c.rn;

-- One quotation per negotiation/quotation_sent lead (approved, then sent)
do $$
declare c record; q uuid;
begin
  for c in select id, assigned_to from public.contacts
            where import_id = '00000000-0000-4000-b000-000000000001' and stage in ('quotation_sent','negotiation') loop
    insert into public.quotations (contact_id, created_by, notes)
    values (c.id, coalesce(c.assigned_to, '00000000-0000-4000-a000-000000000002'), '50% advance, balance on delivery. Demo quotation.')
    returning id into q;
    insert into public.quotation_items (quotation_id, description, quantity, unit_price, discount_pct)
    values (q, 'Website design & development (demo)', 1, 120000, 10), (q, 'Hosting & domain — 1 year', 1, 18000, 0);
    update public.quotations set status = 'approved' where id = q;
    update public.quotations set status = 'sent' where id = q;
  end loop;
end $$;

-- Clear the notifications generated while seeding
delete from public.notifications where user_id in (select id from public.profiles where email like '%@pixhub-demo.test');

select 'Demo data loaded' as result,
       (select count(*) from public.contacts where import_id = '00000000-0000-4000-b000-000000000001') as demo_leads;
