// Loads all migrations + the demo seed into an in-memory Postgres, checks the
// demo data from each role's point of view, then runs the removal script.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import fs from "node:fs";
import assert from "node:assert/strict";

const db = new PGlite({ extensions: { pg_trgm } });
// PGlite has no pgcrypto: stand-ins with the same signatures (Supabase uses real bcrypt).
await db.exec(`
  create role authenticated nologin; create role anon nologin; create role service_role nologin bypassrls;
  create schema extensions;
  create function extensions.gen_salt(text) returns text language sql as $$ select 'salt' $$;
  create function extensions.crypt(text, text) returns text language sql as $$ select md5($1) $$;
  create schema auth;
  create table auth.users (instance_id uuid, id uuid primary key, aud text, role text, email text, encrypted_password text,
    email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb default '{}', created_at timestamptz, updated_at timestamptz,
    confirmation_token text, email_change text, email_change_token_new text, recovery_token text);
  create table auth.identities (id uuid primary key, user_id uuid references auth.users on delete cascade, provider_id text, identity_data jsonb,
    provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated;
`);
for (const f of fs.readdirSync("supabase/migrations").sort()) {
  await db.exec(fs.readFileSync(`supabase/migrations/${f}`, "utf8").replace("create extension if not exists pgcrypto;", ""));
}
await db.exec(`grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated; grant all on all sequences in schema public to authenticated;`);

const seed = fs.readFileSync("supabase/demo/seed-demo.sql", "utf8");
await db.exec(seed);
const once = (await db.query(`select (select count(*) from deals)::int d, (select count(*) from quotations)::int q, (select count(*) from tasks)::int t`)).rows[0];
await db.exec(seed); // re-running must not fail or duplicate
const twice = (await db.query(`select (select count(*) from deals)::int d, (select count(*) from quotations)::int q, (select count(*) from tasks)::int t`)).rows[0];
assert.deepEqual(twice, once, "re-run does not duplicate");

const as = async (uid, sql) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return (await db.query(sql)).rows; } finally { await db.exec("reset role"); }
};
const id = (n) => `00000000-0000-4000-a000-00000000000${n}`;

const roles = (await db.query(`select email, role, manager_id is not null as in_team from profiles order by email`)).rows;
console.log(roles);
assert.equal(roles.find((r) => r.email.startsWith("admin")).role, "admin");
assert.equal(roles.find((r) => r.email.startsWith("manager")).role, "sales_manager");

const pw = (await db.query(`select (encrypted_password = extensions.crypt('PixhubDemo#2026', encrypted_password)) ok from auth.users limit 1`)).rows[0].ok;
assert.equal(pw, true, "password hash matches");

const total = (await as(id(1), `select count(*)::int n from contacts`))[0].n;
const mgr = (await as(id(2), `select count(*)::int n from contacts`))[0].n;
const s1 = (await as(id(3), `select count(*)::int n from contacts`))[0].n;
console.log({ admin_sees: total, manager_sees: mgr, sales1_sees: s1 });
assert.equal(total, 80);
// Manager sees own team + unassigned (all demo leads); an executive only their own.
assert.ok(mgr <= total && s1 < mgr && s1 > 0);

const stats = (await as(id(1), `select dashboard_stats() s`))[0].s;
console.log({ revenue: stats.revenue, open_deals: stats.open_deals, overdue: stats.overdue_follow_ups, tasks_today: stats.tasks_due_today, pending_q: stats.pending_quotations });
assert.ok(Number(stats.revenue) > 0 && stats.open_deals > 0 && stats.pending_quotations > 0);
const recs = (await db.query(`select count(*)::int n from lead_service_recommendations`)).rows[0].n;
assert.ok(recs > 80, `recommendations ${recs}`);
assert.equal((await db.query(`select count(*)::int n from notifications`)).rows[0].n, 0);
assert.equal((await db.query(`select count(*)::int n from contacts where mobile is not null`)).rows[0].n, 0, "no phone numbers in demo data");

await db.exec(fs.readFileSync("supabase/demo/remove-demo.sql", "utf8"));
for (const t of ["contacts", "deals", "quotations", "tasks", "follow_ups", "profiles", "communication_logs"]) {
  assert.equal((await db.query(`select count(*)::int n from ${t}`)).rows[0].n, 0, `${t} emptied`);
}
assert.ok((await db.query(`select count(*)::int n from services`)).rows[0].n > 0, "reference data kept");
const prices = Object.fromEntries((await db.query(`select slug, base_price from services`)).rows.map((r) => [r.slug, r.base_price === null ? null : Number(r.base_price)]));
assert.equal(prices["starter-website"], 15000, "real pixhub.lk price kept");
assert.equal(prices["social-growth"], 50000, "real pixhub.lk price kept");
assert.equal(prices["seo"], null, "demo-only price removed");
assert.equal(prices["ecommerce-store"], null, "demo-only price removed");
assert.equal((await db.query(`select count(*)::int n from audit_logs where table_name in ('contacts','deals','quotations','profiles') and action <> 'DELETE'`)).rows[0].n, 0, "demo audit entries removed (the record of the removal itself is kept)");
assert.ok((await db.query(`select count(*)::int n from audit_logs where table_name = 'services'`)).rows[0].n > 0, "setup history kept");
assert.equal((await db.query(`select count(*)::int n from auth.users`)).rows[0].n, 0, "demo logins removed");
console.log("Demo seed + removal OK");
await db.close();
