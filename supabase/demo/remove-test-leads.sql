-- Removes the email-test leads and test campaign (everything named "[TEST]").
-- Real leads and campaigns are not touched.
delete from public.email_campaigns where name like '[TEST]%';
delete from public.contacts where company_name like '[TEST]%';
select 'Test leads and campaigns removed' as result;
