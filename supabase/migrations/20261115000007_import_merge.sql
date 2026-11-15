-- =====================================================================
-- PIXhub Sales CRM — "Fill in missing details" imports
-- Re-importing a sheet can add emails, websites, contact people, etc. to
-- leads that already exist, without creating duplicates. Existing values
-- are never overwritten; only empty fields are filled.
-- =====================================================================

alter table public.lead_imports add column updated_rows int not null default 0;

-- Fast lookups by normalised company name (same normalisation as dedupe_key)
create index contacts_norm_name_idx on public.contacts (lower(regexp_replace(company_name, '[^a-zA-Z0-9]', '', 'g')));

/*
  p_rows: array of prepared rows (company_name, mobile, email, website, …) in file order.
  Matching, in order:
    1. same mobile number
    2. same company name (ignoring spaces/punctuation/case) — only when exactly ONE lead
       matches, narrowed by district / city when the sheet has them
  Returns one entry per row: {"i": index, "id": matched lead or null, "filled": [field names]}.
*/
create or replace function public.merge_contacts(p_rows jsonb, p_import uuid default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  r jsonb; i int := -1; cid uuid; nm text; filled text[]; res jsonb := '[]'::jsonb; cur record;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be an array'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'At most 1000 rows per call'; end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    i := i + 1; cid := null; filled := '{}';

    if nullif(r->>'mobile', '') is not null then
      select id into cid from public.contacts where dedupe_key = 'm:' || (r->>'mobile');
    end if;

    if cid is null and nullif(trim(r->>'company_name'), '') is not null then
      nm := lower(regexp_replace(r->>'company_name', '[^a-zA-Z0-9]', '', 'g'));
      if length(nm) >= 3 then
        select min(x.id::text)::uuid into cid from (
          select id from public.contacts
           where lower(regexp_replace(company_name, '[^a-zA-Z0-9]', '', 'g')) = nm
             and (nullif(r->>'district', '') is null or district is null or lower(district) = lower(r->>'district'))
             and (nullif(r->>'city', '') is null or city is null or lower(city) = lower(r->>'city'))
           limit 2
        ) x having count(*) = 1;
      end if;
    end if;

    if cid is not null then
      select email, website, facebook_url, contact_person, landline, mobile, city, district, industry, address
        into cur from public.contacts where id = cid;
      if cur.email is null and nullif(r->>'email', '') is not null then filled := array_append(filled, 'email'); end if;
      if cur.website is null and nullif(r->>'website', '') is not null then filled := array_append(filled, 'website'); end if;
      if cur.facebook_url is null and nullif(r->>'facebook_url', '') is not null then filled := array_append(filled, 'facebook'); end if;
      if cur.contact_person is null and nullif(r->>'contact_person', '') is not null then filled := array_append(filled, 'contact person'); end if;
      if cur.landline is null and nullif(r->>'landline', '') is not null then filled := array_append(filled, 'landline'); end if;
      if cur.mobile is null and nullif(r->>'mobile', '') is not null then filled := array_append(filled, 'mobile'); end if;
      if cur.city is null and nullif(r->>'city', '') is not null then filled := array_append(filled, 'city'); end if;
      if cur.district is null and nullif(r->>'district', '') is not null then filled := array_append(filled, 'district'); end if;
      if cur.industry is null and nullif(r->>'industry', '') is not null then filled := array_append(filled, 'industry'); end if;
      if cur.address is null and nullif(r->>'address', '') is not null then filled := array_append(filled, 'address'); end if;

      if cardinality(filled) > 0 then
        begin
          update public.contacts set
            email = coalesce(email, nullif(r->>'email', '')),
            website = coalesce(website, nullif(r->>'website', '')),
            facebook_url = coalesce(facebook_url, nullif(r->>'facebook_url', '')),
            contact_person = coalesce(contact_person, nullif(r->>'contact_person', '')),
            landline = coalesce(landline, nullif(r->>'landline', '')),
            mobile = coalesce(mobile, nullif(r->>'mobile', '')),
            city = coalesce(city, nullif(r->>'city', '')),
            district = coalesce(district, nullif(r->>'district', '')),
            industry = coalesce(industry, nullif(r->>'industry', '')),
            address = coalesce(address, nullif(r->>'address', ''))
          where id = cid;
          insert into public.deal_activities (contact_id, type, description, metadata, created_by)
          values (cid, 'import', 'Details added from an import: ' || array_to_string(filled, ', '),
                  jsonb_build_object('import_id', p_import, 'fields', filled), auth.uid());
        exception when unique_violation then
          -- e.g. the new mobile already belongs to another lead: keep the lead unchanged
          filled := '{}';
        end;
      end if;
    end if;

    res := res || jsonb_build_object('i', i, 'id', cid, 'filled', to_jsonb(filled));
  end loop;
  return res;
end $$;
