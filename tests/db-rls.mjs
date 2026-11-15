import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import fs from "node:fs";
import path from "node:path";

const migDir = process.argv[2];
const db = new PGlite({ extensions: { pg_trgm } });

// Minimal Supabase stand-ins
await db.exec(`
  create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
`);

for (const f of fs.readdirSync(migDir).sort()) {
  let sql = fs.readFileSync(path.join(migDir, f), "utf8");
  sql = sql.replace(/create extension if not exists pgcrypto;/, "");
  try { await db.exec(sql); console.log("OK  ", f); }
  catch (e) { console.error("FAIL", f, e.message); process.exit(1); }
}
await db.exec(`grant usage on schema public to authenticated;
  grant all on all tables in schema public to authenticated;
  grant all on all sequences in schema public to authenticated;`);

const A = "00000000-0000-0000-0000-00000000000a", M = "00000000-0000-0000-0000-00000000000b", E = "00000000-0000-0000-0000-00000000000c", E2 = "00000000-0000-0000-0000-00000000000d";
await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values
  ('${A}','admin@x.lk','{"full_name":"Admin"}'),('${M}','mgr@x.lk','{"full_name":"Manager","role":"admin"}'),
  ('${E}','exec@x.lk','{}'),('${E2}','exec2@x.lk','{}');`);
const roles = (await db.query(`select email, role from public.profiles order by email`)).rows;
console.log("roles:", JSON.stringify(roles));
await db.exec(`update public.profiles set role='sales_manager' where id='${M}'; update public.profiles set manager_id='${M}' where id='${E}';`);

const as = async (uid, sql, params) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: e.message }; } finally { await db.exec("reset role"); }
};
const check = (name, cond, extra = "") => { console.log(cond ? "PASS" : "FAIL", name, extra); if (!cond) process.exitCode = 1; };

// Admin inserts contacts (one dup)
let r = await as(A, `insert into contacts(company_name, industry, mobile, city, assigned_to) values
  ('Ceylon Spice Restaurant','Restaurant','+94771234567','Kandy','${E}'),
  ('Blue Wave Hotel','Hotels & Resorts','+94712345678','Galle',null),
  ('Pinnacle Hardware','hardware store',null,'Colombo','${E2}'),
  ('Dup Restaurant','Restaurant','+94771234567','Kandy',null)
  on conflict (dedupe_key) do nothing returning id, company_name`);
check("admin insert w/ dedupe", r.rows?.length === 3, JSON.stringify(r.error ?? r.rows.map(x => x.company_name)));
const ids = r.rows.map(x => x.id);

r = await as(A, `select classify_contacts($1::uuid[]) n`, [ids]);
check("classify", r.rows?.[0]?.n === 3, r.error ?? "");
r = await as(A, `select c.company_name, s.slug, l.confidence, l.basis from lead_service_recommendations l join services s on s.id=l.service_id join contacts c on c.id=l.contact_id order by 1, 3 desc`);
console.log(r.rows.map(x => `${x.company_name} → ${x.slug} ${x.confidence} ${x.basis}`).join("\n"));
check("hotel matched booking", r.rows.some(x => x.company_name === "Blue Wave Hotel" && x.slug === "booking-website"));
check("'inn' not matched inside words", !r.rows.some(x => x.reason?.includes('"inn"')));
r = await as(A, `select company_name, lead_score, score_breakdown from contacts order by 1`);
console.log(r.rows.map(x => `${x.company_name}: ${x.lead_score} [${x.score_breakdown.map(f => f.factor + "=" + f.points + "/" + f.kind).join(", ")}]`).join("\n"));
check("scores computed", r.rows.every(x => x.lead_score > 0));

// Visibility
r = await as(E, `select company_name from contacts`); check("exec sees only own", r.rows?.length === 1, JSON.stringify(r.rows ?? r.error));
r = await as(M, `select company_name from contacts order by 1`); check("manager sees team + unassigned", r.rows?.length === 2, JSON.stringify(r.rows));
r = await as(E2, `select company_name from contacts`); check("exec2 sees only own", r.rows?.length === 1, JSON.stringify(r.rows));

// Exec cannot reassign
r = await as(E, `update contacts set assigned_to='${E2}' where id='${ids[0]}'`); check("exec reassign blocked", !!r.error, r.error ?? "");
// Exec cannot update others' contacts (silently 0 rows)
r = await as(E, `update contacts set stage='won' where id='${ids[1]}' returning id`); check("exec can't touch other", r.rows?.length === 0);
// Exec cannot change own role
r = await as(E, `update profiles set role='admin' where id='${E}'`); check("exec role escalation blocked", !!r.error, r.error ?? "");
// Exec cannot import
r = await as(E, `insert into lead_imports(file_name) values ('x')`); check("exec import blocked", !!r.error);
// Exec cannot delete
r = await as(E, `delete from contacts where id='${ids[0]}' returning id`); check("exec delete blocked", r.rows?.length === 0);

// Outreach log → status + stage
r = await as(E, `insert into communication_logs(contact_id,status,created_by) values ('${ids[0]}','chat_opened','${E}')`); check("log chat_opened", !r.error, r.error ?? "");
r = await as(E, `select whatsapp_status, stage, last_contacted_at from contacts where id='${ids[0]}'`);
check("chat_opened does not mark contacted", r.rows[0].whatsapp_status === "chat_opened" && r.rows[0].stage === "new" && r.rows[0].last_contacted_at === null, JSON.stringify(r.rows[0]));
await as(E, `insert into communication_logs(contact_id,status,created_by) values ('${ids[0]}','interested','${E}')`);
r = await as(E, `select whatsapp_status, stage, lead_score from contacts where id='${ids[0]}'`);
check("interested → stage interested", r.rows[0].stage === "interested", JSON.stringify(r.rows[0]));

// Follow-up sync
r = await as(E, `insert into follow_ups(contact_id,due_at,assigned_to,created_by) values ('${ids[0]}', now() - interval '1 day', '${E}', '${E}')`); check("follow-up insert", !r.error, r.error ?? "");
r = await as(E, `select next_follow_up_at from contacts where id='${ids[0]}'`); check("next_follow_up synced", !!r.rows[0].next_follow_up_at);

// DNC blocks outbound
await as(E, `update contacts set do_not_contact=true where id='${ids[0]}'`);
r = await as(E, `insert into communication_logs(contact_id,status,created_by) values ('${ids[0]}','contacted','${E}')`); check("DNC blocks outreach", !!r.error, r.error ?? "");
r = await as(E, `select lead_score, opted_out_at from contacts where id='${ids[0]}'`); check("DNC score 0", r.rows[0].lead_score === 0 && !!r.rows[0].opted_out_at);

// Dashboard functions
r = await as(A, `select dashboard_stats() s`); check("dashboard_stats", !r.error, r.error ?? JSON.stringify(r.rows[0].s));
r = await as(E, `select dashboard_stats() s`); check("dashboard_stats scoped", r.rows?.[0]?.s.total_leads === 1);
r = await as(A, `select dashboard_breakdowns() b`); check("dashboard_breakdowns", !r.error, r.error ?? Object.keys(r.rows[0].b).join(","));
r = await as(A, `select lead_filter_options() o`); check("lead_filter_options", !r.error, r.error ?? "");
r = await as(A, `select log_audit('EXPORT','contacts','{"n":1}')`); check("log_audit", !r.error, r.error ?? "");
r = await as(A, `select count(*)::int n from audit_logs`); check("audit logs written", r.rows[0].n > 0, String(r.rows[0].n));
r = await as(E, `select count(*)::int n from audit_logs`); check("exec can't read audit", r.rows[0].n === 0);

// Quotation approval guard
await as(E, `update contacts set do_not_contact=false where id='${ids[0]}'`);
r = await as(E, `insert into quotations(contact_id, created_by) values ('${ids[0]}','${E}') returning id, number`); check("quotation insert", !r.error, r.error ?? r.rows[0].number);
const qid = r.rows?.[0]?.id;
r = await as(E, `update quotations set status='approved' where id='${qid}'`); check("exec can't approve quotation", !!r.error);
r = await as(M, `update quotations set status='approved', approved_by='${M}' where id='${qid}' returning id`);
check("manager can't approve empty quotation", !!r.error, r.error ?? "");

// ===================== Phase 2 =====================
// Quotation totals + workflow
r = await as(E, `insert into quotation_items(quotation_id, description, quantity, unit_price, discount_pct) values
  ('${qid}','Website',1,150000,10),('${qid}','Hosting (year)',2,12000,0)`);
check("items insert", !r.error, r.error ?? "");
r = await as(E, `update quotations set discount_amount=4000, tax_rate=18 where id='${qid}' returning subtotal, tax_amount, total`);
const q = r.rows?.[0];
check("quotation totals", q && Number(q.subtotal) === 159000 && Number(q.tax_amount) === 27900 && Number(q.total) === 182900, JSON.stringify(q ?? r.error));
r = await as(E, `update quotations set status='sent' where id='${qid}'`); check("can't send unapproved", !!r.error, r.error ?? "");
r = await as(E, `update quotations set status='pending_approval' where id='${qid}'`); check("exec submits", !r.error, r.error ?? "");
r = await as(M, `select count(*)::int n from notifications where user_id='${M}' and kind='quotation'`); check("manager notified for approval", r.rows[0].n === 1);
r = await as(M, `update quotations set status='approved' where id='${qid}' returning approved_by`); check("manager approves", r.rows?.[0]?.approved_by === M, r.error ?? "");
r = await as(E, `insert into quotation_items(quotation_id, description, unit_price) values ('${qid}','Extra',1000)`); check("items frozen after approval", !!r.error);
r = await as(E, `update quotations set tax_rate=0 where id='${qid}'`); check("financials frozen after approval", !!r.error);
r = await as(E, `update quotations set status='sent' where id='${qid}'`); check("send approved", !r.error, r.error ?? "");
r = await as(E, `select stage from contacts where id='${ids[0]}'`); check("sent → lead quotation_sent", r.rows[0].stage === "quotation_sent", r.rows[0].stage);

// Deals
r = await as(E, `insert into deals(contact_id, title, value, assigned_to) values ('${ids[0]}','Website project',200000,'${E}') returning id, probability`);
check("exec creates deal", !r.error && r.rows[0].probability === 10, r.error ?? JSON.stringify(r.rows[0]));
const did = r.rows?.[0]?.id;
r = await as(E, `update deals set stage='negotiation' where id='${did}' returning probability`); check("probability follows stage", r.rows?.[0]?.probability === 75);
r = await as(E, `select stage from contacts where id='${ids[0]}'`); check("deal moves lead forward", r.rows[0].stage === "negotiation", r.rows[0].stage);
r = await as(E, `update deals set stage='won' where id='${did}' returning closed_at`); check("deal won closes", !!r.rows?.[0]?.closed_at);
r = await as(M, `select count(*)::int n from notifications where user_id='${M}' and kind='deal'`); check("manager notified of win", r.rows[0].n === 1);
r = await as(A, `select dashboard_stats() s`); check("revenue from won deal", Number(r.rows[0].s.revenue) === 200000, String(r.rows?.[0]?.s.revenue));
r = await as(A, `select dashboard_breakdowns() b`); check("revenue_by_service", Array.isArray(r.rows?.[0]?.b.revenue_by_service), r.error ?? "");
r = await as(E2, `select count(*)::int n from deals`); check("exec2 can't see deal", r.rows[0].n === 0);

// Tasks
r = await as(M, `insert into tasks(title, assigned_to, due_at, created_by) values ('Call Ceylon Spice','${E}', now() + interval '30 minutes', '${M}') returning id`);
check("manager assigns task", !r.error, r.error ?? "");
const tid = r.rows?.[0]?.id;
r = await as(E, `insert into tasks(title, assigned_to, created_by) values ('x','${E2}','${E}')`); check("exec can't assign others", !!r.error);
r = await as(E, `select count(*)::int n from notifications where user_id='${E}' and kind='task'`); check("assignee notified", r.rows[0].n === 1);
r = await as(E, `update tasks set status='done' where id='${tid}' returning completed_at`); check("task completion", !!r.rows?.[0]?.completed_at);
r = await as(E, `select type from task_events where task_id='${tid}' order by created_at`); check("task events", r.rows?.length === 2, JSON.stringify(r.rows));
r = await as(E2, `select count(*)::int n from tasks`); check("exec2 can't see task", r.rows[0].n === 0);

// Reminders
await as(E, `insert into tasks(title, assigned_to, due_at, created_by) values ('Soon','${E}', now() + interval '10 minutes','${E}')`);
r = await as(E, `select run_housekeeping() h`); check("housekeeping", !r.error, r.error ?? JSON.stringify(r.rows[0].h));
const rem1 = r.rows?.[0]?.h.reminders;
r = await as(E, `select run_housekeeping() h`); check("reminders not duplicated", r.rows?.[0]?.h.reminders === 0 && rem1 >= 1, `${rem1}`);
r = await as(E, `select mark_notifications_read() n`); check("mark all read", r.rows?.[0]?.n > 0);
r = await as(E, `select count(*)::int n from notifications`); const myN = r.rows[0].n;
r = await as(E, `select count(*)::int n from notifications where user_id <> '${E}'`); check("only own notifications visible", r.rows[0].n === 0 && myN > 0);
r = await as(E, `select notify('${E2}','x','y','/','general',false,false)`); check("notify() not callable by users", !!r.error);

// save_quotation RPC
r = await as(E, `select save_quotation(null, '${ids[0]}', null, current_date, current_date + 30, 1000, 18, 'n',
  '[{"description":"Landing page","quantity":1,"unit_price":50000},{"description":"SEO","quantity":3,"unit_price":10000,"discount_pct":10}]'::jsonb) id`);
check("save_quotation create", !r.error, r.error ?? "");
const q3 = r.rows?.[0]?.id;
r = await as(E, `select subtotal, total from quotations where id='${q3}'`);
check("save_quotation totals", Number(r.rows[0].subtotal) === 77000 && Number(r.rows[0].total) === 89680, JSON.stringify(r.rows[0]));
r = await as(E, `select save_quotation('${q3}', '${ids[0]}', null, current_date, current_date + 30, 0, 0, null, '[{"description":"Only","quantity":1,"unit_price":5}]'::jsonb) id`);
r = await as(E, `select count(*)::int n, max(q.total) t from quotation_items i join quotations q on q.id=i.quotation_id where q.id='${q3}'`);
check("save_quotation edit replaces items", r.rows[0].n === 1 && Number(r.rows[0].t) === 5, JSON.stringify(r.rows[0]));
r = await as(E2, `select save_quotation(null, '${ids[0]}', null, current_date, current_date + 30, 0, 0, null, '[{"description":"x","quantity":1,"unit_price":5}]'::jsonb)`);
check("save_quotation blocked for other's lead", !!r.error, r.error ?? "");

// Expiry
r = await as(M, `insert into quotations(contact_id, created_by, issue_date, expiry_date) values ('${ids[1]}','${M}', current_date - 40, current_date - 10) returning id`);
const q2 = r.rows?.[0]?.id;
await as(M, `insert into quotation_items(quotation_id, description, unit_price) values ('${q2}','Ads',50000)`);
await as(M, `update quotations set status='approved' where id='${q2}'`);
r = await as(A, `select expire_quotations() n`); check("expire quotations", r.rows?.[0]?.n === 1, r.error ?? String(r.rows?.[0]?.n));
// ===================== Phase 3 =====================
const wa = (extra) => `insert into communication_logs(contact_id,status,created_by,source,direction,template_name,external_id) values ('${ids[0]}','contacted','${E}','whatsapp_cloud_api','outbound',${extra})`;
r = await as(E, wa(`'pixhub_intro','wamid.1'`)); check("template send blocked without opt-in", !!r.error, r.error ?? "");
r = await as(E, wa(`null,'wamid.0'`)); check("free text blocked outside 24h window", !!r.error, r.error ?? "");
await as(E, `update contacts set whatsapp_opt_in_at=now(), whatsapp_opt_in_source='Asked us on call', whatsapp_opt_in_by='${E}' where id='${ids[0]}'`);
r = await as(E, wa(`'pixhub_intro','wamid.1'`)); check("template send allowed with opt-in", !r.error, r.error ?? "");
r = await as(E, `select whatsapp_sends_last_hour() n`); check("send counter", r.rows?.[0]?.n === 1);
await db.exec(`reset role; select public.apply_whatsapp_status('wamid.1','delivered'); select public.apply_whatsapp_status('wamid.1','sent');`);
r = await as(E, `select delivery_status from communication_logs where external_id='wamid.1'`); check("status only moves forward", r.rows[0].delivery_status === "delivered", r.rows[0].delivery_status);
r = await as(E, `select apply_whatsapp_status('wamid.1','read')`); check("status fn not callable by users", !!r.error);
await db.exec(`reset role; insert into communication_logs(contact_id,status,direction,source,body) values ('${ids[0]}','replied','inbound','whatsapp_cloud_api','Yes tell me more')`);
r = await as(E, `select last_inbound_at, whatsapp_status from contacts where id='${ids[0]}'`); check("inbound opens 24h window", !!r.rows[0].last_inbound_at && r.rows[0].whatsapp_status === "replied");
r = await as(E, wa(`null,'wamid.2'`)); check("free text allowed in 24h window", !r.error, r.error ?? "");
await as(E, `update contacts set do_not_contact=true where id='${ids[0]}'`);
r = await as(E, `select whatsapp_opt_in_at from contacts where id='${ids[0]}'`); check("opt-out clears opt-in", r.rows[0].whatsapp_opt_in_at === null);
await as(E, `update contacts set do_not_contact=false where id='${ids[0]}'`);

r = await as(E, `insert into ai_requests(user_id, feature, contact_id) values ('${E}','summary','${ids[0]}')`); check("ai request log", !r.error, r.error ?? "");
r = await as(E, `insert into ai_requests(user_id, feature) values ('${E2}','chat')`); check("can't log AI for others", !!r.error);
r = await as(E, `select ai_requests_last_hour() n`); check("AI hourly counter", r.rows?.[0]?.n === 1);

r = await as(E, `insert into lead_enrichment(contact_id, source_url, is_live, http_status, checked_by) values ('${ids[0]}','https://example.lk',true,200,'${E}')`); check("enrichment insert", !r.error, r.error ?? "");
r = await as(E2, `insert into lead_enrichment(contact_id, source_url, is_live, checked_by) values ('${ids[0]}','https://x.lk',true,'${E2}')`); check("enrichment blocked on other's lead", !!r.error);
r = await as(E2, `select count(*)::int n from lead_enrichment`); check("enrichment hidden from other exec", r.rows[0].n === 0);

r = await as(A, `select advanced_analytics() a`); check("advanced_analytics", !r.error, r.error ?? Object.keys(r.rows[0].a).join(","));
r = await as(E, `insert into whatsapp_templates(name, body_preview) values ('x','y')`); check("only admin manages WA templates", !!r.error);
r = await as(A, `insert into whatsapp_templates(name, body_preview, params) values ('pixhub_intro','Hello {{1}}', '{company}')`); check("admin adds WA template", !r.error, r.error ?? "");
await db.close();
