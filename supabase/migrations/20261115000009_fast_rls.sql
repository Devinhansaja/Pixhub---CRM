-- =====================================================================
-- Faster Row Level Security for large lead tables (same rules, faster).
-- The old policies called can_access_owner() for EVERY row, and that function
-- looked up the user's role every time (~17k + ~45k calls per dashboard).
-- Here the role / user id / team are wrapped in (select ...) so Postgres
-- evaluates them ONCE per query (init-plans), then compares plain columns.
-- Visibility is unchanged:
--   admin: everything / manager: own + team members' + unassigned
--   executive: own only / inactive / unknown user: nothing
-- =====================================================================

-- contacts ------------------------------------------------------------
drop policy contacts_select on public.contacts;
create policy contacts_select on public.contacts for select to authenticated using (
  case (select public.current_user_role())
    when 'admin' then true
    when 'sales_manager' then assigned_to is null or assigned_to = (select auth.uid())
                              or assigned_to in (select p.id from public.profiles p where p.manager_id = (select auth.uid()))
    when 'sales_executive' then assigned_to = (select auth.uid())
    else false
  end
);

drop policy contacts_update on public.contacts;
create policy contacts_update on public.contacts for update to authenticated
  using (
    case (select public.current_user_role())
      when 'admin' then true
      when 'sales_manager' then assigned_to is null or assigned_to = (select auth.uid())
                                or assigned_to in (select p.id from public.profiles p where p.manager_id = (select auth.uid()))
      when 'sales_executive' then assigned_to = (select auth.uid())
      else false
    end)
  with check ((select public.is_manager_or_admin()) or assigned_to = (select auth.uid()));

-- Child tables: admins skip the per-row parent lookup entirely ----------
drop policy lsr_all on public.lead_service_recommendations;
create policy lsr_all on public.lead_service_recommendations for all to authenticated
  using ((select public.is_admin()) or exists (select 1 from public.contacts c where c.id = contact_id))
  with check ((select public.is_admin()) or exists (select 1 from public.contacts c where c.id = contact_id));

drop policy activities_select on public.deal_activities;
create policy activities_select on public.deal_activities for select to authenticated
  using ((select public.is_admin()) or exists (select 1 from public.contacts c where c.id = contact_id));

drop policy comm_select on public.communication_logs;
create policy comm_select on public.communication_logs for select to authenticated
  using ((select public.is_admin()) or exists (select 1 from public.contacts c where c.id = contact_id));

drop policy quotations_select on public.quotations;
create policy quotations_select on public.quotations for select to authenticated
  using ((select public.is_admin()) or exists (select 1 from public.contacts c where c.id = contact_id));

-- Speeds up the "exists parent contact" checks and the dashboard joins
create index if not exists lsr_contact_idx on public.lead_service_recommendations(contact_id);
