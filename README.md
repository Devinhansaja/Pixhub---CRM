# PIXhub Sales CRM

Sales CRM for **PIXhub.lk**: import business databases from Excel, find the right PIXhub service for every company, do WhatsApp outreach and track every lead through to a sale.

Stack: Next.js 14 (App Router, TypeScript) · Tailwind CSS · Supabase (Postgres, Auth, RLS) · SheetJS · Recharts · Vercel. Timezone **Asia/Colombo**, currency **LKR**.

---

## What's in Phase 1 (working now)

| Page | What works |
|---|---|
| **Login** | Email + password, password reset by email, inactive-user lockout |
| **Dashboard** | Live KPIs (total, new, qualified, contacted, interested, quotations, won/lost, revenue, pipeline, conversion, overdue follow-ups), my follow-ups, "calls to make", monthly chart, funnel, service demand, industries |
| **All Leads** | Search (name/phone/email), 10 filters, sort, pagination, bulk assign (managers/admins), export filtered records to .xlsx |
| **Lead Details** | Contact info, stage change, assignment, explainable score (fact vs assumption), service recommendations (confirm/remove/add), WhatsApp panel, notes and activity timeline, follow-ups, manual website/Facebook checks (with timestamp and source URL), do-not-contact, edit details |
| **Import Database** | .xlsx/.xls/.csv, multiple sheets, auto-detects columns, manual mapping, +94 normalisation, invalid-number detection, duplicate detection (in the file and against the database), preview, batches of 500 with progress and cancel, optional bulk assignment, import history |
| **Smart Classification** | Rules (keyword → service, weight, reason) that admins can edit, data-gap suggestions, service demand chart, browse leads by service, re-classify everything |
| **Sales Pipeline** | Drag-and-drop Kanban across the 10 stages |
| **WhatsApp Outreach** | Work queues (not started / opened / awaiting reply / follow-up / interested), personalised templates, click-to-chat links, manual status confirmation |
| **Tasks & Follow-ups** | Overdue / today / upcoming lists, done, reschedule, cancel, team view for managers |
| **Analytics & Reports** | All KPIs, monthly performance, funnel, stages, service demand, industry, districts, salesperson table |
| **Team Management** | Invite employees by email, set role and manager, enable/disable accounts |
| **Settings** | Profile, password, WhatsApp templates with live preview, company details |

## What's in Phase 2 (working now)

| Area | What works |
|---|---|
| **Deals** | Several deals per company (service, value, probability, expected close, salesperson), created and edited on the lead page. Probability follows the stage unless you set it yourself. Winning a deal moves the lead forward and notifies the manager |
| **Sales Pipeline** | Drag-and-drop **Deals** board (open, weighted and total value) plus the Leads board |
| **Quotations** | Builder with service package prices, per-line discount, overall discount and tax. Workflow: draft → submit → manager approves / requests changes → mark sent → accepted / rejected. Expiry is automatic. "Duplicate as new draft". Branded A4 **PDF**, watermarked DRAFT until approved. Totals are calculated by the database |
| **Tasks** | My day (tasks and follow-ups: overdue / today / upcoming), drag-and-drop board, filterable list, task page with comments and an automatic activity log, priorities, due dates, reminders, +1 day reschedule, team view for managers |
| **Notifications** | In-app bell (unread count, mark read). Created automatically for task assignment and reminders, follow-ups due, quotations needing approval / approved / changes requested, deal assigned / won. Optional **email** through an Edge Function |
| **Daily dashboard** | Follow-ups today, overdue items, tasks due, upcoming meetings, quotations awaiting approval |
| **Reports** | Revenue by service, deals by stage, quotations by status, weighted pipeline. Revenue now comes from won deals (plus won leads that have no deals) |
| **Settings** | Service package prices and descriptions (admin), default tax rate, company details printed on PDFs |

Database rules (all tested): quotations can't be sent before approval; approved/sent quotations are frozen; only managers approve; sales executives can't assign tasks or deals to others; users only see their own notifications; reminders are never duplicated.

## What's in Phase 3 (working now — each part switches on when its keys are set)

| Area | What works |
|---|---|
| **AI Sales Assistant** (Claude Opus 5.5, server-side) | Chat page that answers questions using read-only CRM tools (search leads, lead details, pipeline overview, my agenda, leads going cold). It only sees what the signed-in user can see (RLS). Links to leads in its answers |
| **AI on the lead page** | *Summary & next action* (facts and assumptions listed separately), *Suggest services* (choose from PIXhub's real service list; saved only when you click, as **unverified "ai"** suggestions, never overwriting confirmed ones), *Draft WhatsApp message* in English, Sinhala or Tamil for first contact, follow-up, meeting, quotation or re-engagement |
| **Lead enrichment** | "Check now" on a lead, or "Check 25 websites" on Smart Classification: live/offline, HTTP status, HTTPS, mobile-friendly, title/description, Facebook link on the site, online-shop signals. Each check is stored with its URL and time and updates the lead score. A Facebook link found on the company's own site fills an empty Facebook field |
| **WhatsApp Business API** | Record opt-in (how and when the customer agreed). Send Meta-approved templates to opted-in contacts, with fields filled from the CRM. Free-text replies within the 24-hour window. A signed webhook records delivery status (sent → delivered → read / failed) and inbound replies. **STOP** (also in Sinhala and Tamil) marks the contact do-not-contact. The assigned salesperson is notified. Admins manage templates on the WhatsApp Outreach page |
| **Advanced analytics** | WhatsApp outreach funnel, conversion by lead-score band (checks the score works), reply rate by template and by industry, win rate and average deal by service, days to win / to close, team activity over the last 30 days, leads going cold, enrichment and opt-in totals |

**Safeguards, enforced in the database:** template sends need recorded opt-in; free text needs a customer message in the last 24 hours; opting out clears opt-in; delivery status can only move forward; per-user hourly caps on AI requests (60) and API messages (30); there is no bulk send.

**AI safeguards:** the system prompt forbids inventing website, Facebook or interest facts. CRM text is passed as data, not instructions. The model is told to label assumptions. Contact numbers and emails aren't sent to the model. Usage is logged per user (tokens, no prompt text). Refusal fallback is on (`fallbacks: "default"`).

### Honesty rules built into the data model
- A **valid mobile** only means the *format* is correct. The UI always says the WhatsApp account is not verified.
- **Opening a WhatsApp chat ≠ sent.** "Chat opened" never changes the stage or `last_contacted_at`. Only "I sent it — mark contacted" (confirmed by a person) does.
- Every score factor and recommendation is labelled **fact** or **assumption**. Category-based suggestions stay unverified until a salesperson confirms them.
- Website and Facebook status is only stored after a manual check, together with the URL checked and the time.
- **Do-not-contact** sets the score to 0, hides the lead from WhatsApp queues, and the database refuses outbound logs for it.

---

## Setup

### 1. Create a Supabase project
1. Go to https://supabase.com, create a project and pick the **Singapore (ap-southeast-1)** region (the closest to Sri Lanka).
2. **Authentication → Providers → Email:** turn **off** "Allow new users to sign up". Staff join only by admin invitation.
3. **Authentication → URL Configuration:** set Site URL to your app URL and add `https://YOUR-DOMAIN/auth/callback` (and `http://localhost:3000/auth/callback`) to Redirect URLs.

### 2. Apply the database migrations
Run these files in order: in the Supabase **SQL Editor**, paste each one and click Run.

```
supabase/migrations/20261113000001_schema.sql
supabase/migrations/20261113000002_functions_rls.sql
supabase/migrations/20261113000003_seed.sql
supabase/migrations/20261114000004_phase2.sql
supabase/migrations/20261114000005_phase3.sql
```

Or with the Supabase CLI:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

```bash
npx supabase db push
```

### 3. Environment variables
Copy `.env.example` to `.env.local` and fill it in from **Project Settings → API**:

| Variable | Where it is used |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser and server. Safe to expose because RLS protects the data |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only**, for inviting and disabling users. Never add the `NEXT_PUBLIC_` prefix |
| `NEXT_PUBLIC_SITE_URL` | Links in invite and reset emails |

### 4. Run locally

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000.

### 4b. Test with demo data first (recommended)
Try everything before loading your real database:
1. Create a **separate free Supabase project** just for testing, and run the 5 migrations in it.
2. In its SQL Editor, run `supabase/demo/seed-demo.sql`. This creates 4 demo logins (admin, manager, two salespeople) and 80 fictional businesses with deals, tasks, follow-ups and quotations. **The logins and password are listed at the top of that file.**
3. Put that test project's keys in `.env.local`, run `npm run dev`, and sign in as each role to see what they can and can't do.
4. When you're done, run `supabase/demo/remove-demo.sql` to delete all demo records and logins. Or delete the test project.

Demo businesses have no phone numbers (a made-up number could belong to a real person). To test WhatsApp, add your own mobile to a demo lead.

### 5. Create the first admin
Sign-ups are off, so create the first user in **Supabase → Authentication → Users → Add user** (email + password, tick "Auto confirm"). **The first user ever created automatically becomes Admin.** Everyone after that is created as a Sales Executive. Add the rest of the team from **Team Management** in the app (invite by email, choose role and manager).

### 6. Import your database (e.g. `Data Base new.xlsx`)
**Import Database →** drop the file → check the auto-detected column mapping (change any column with the dropdowns) → review the preview and statistics → optionally choose a salesperson to assign the leads to → **Import**. Keep the tab open until it finishes. 100k rows takes a few minutes.

### 7. Set service prices
**Settings → Services & package pricing** (admin). These prices fill in quotation items automatically. Set the default tax rate and the company details printed on PDFs on the same page.

### 8. Reminders and email notifications (optional, recommended)
In-app reminders already work without any setup: they are generated each time someone loads a page. To get them on time even when nobody is using the app, and to send email:

1. Create a free https://resend.com account and verify your sending domain.
2. Deploy the email function and set its secrets:

```bash
npx supabase functions deploy send-notification-emails --no-verify-jwt
```

```bash
npx supabase secrets set RESEND_API_KEY=re_xxx EMAIL_FROM="PIXhub CRM <crm@yourdomain.lk>" APP_URL=https://your-app.vercel.app CRON_SECRET=choose-a-long-random-string
```

3. In Supabase go to **Database → Extensions** and enable `pg_cron` and `pg_net`.
4. Open `supabase/cron.sql`, put in your project ref and the same `CRON_SECRET`, and run it in the SQL Editor. It runs reminders and quotation expiry every 5 minutes and sends emails every 5 minutes.

Emails go out for task assignments and reminders, follow-ups due, and quotation approval steps. Without `RESEND_API_KEY` the function sends nothing and the notifications stay in-app only.

### 9. AI assistant (optional)
1. Create an API key at https://platform.claude.com (Settings → API keys) and add billing.
2. Set `ANTHROPIC_API_KEY` in Vercel (or `.env.local`) — server only, never `NEXT_PUBLIC_`.
3. Optional: `ANTHROPIC_MODEL` (default `claude-opus-5-5`) and `AI_HOURLY_LIMIT` (default 60 per user).

Cost guide: Claude Opus 5.5 is $4 / $20 per million input / output tokens. A lead summary or message draft is typically a few thousand tokens, around one or two US cents. Admins can see usage in the `ai_requests` table.

### 10. WhatsApp Business API (optional)
Requires a Meta Business account, a WhatsApp Business phone number and **Meta-approved message templates**.
1. In Meta for Developers create an app → add **WhatsApp**. Note the **Phone number ID**, and create a **permanent access token** for a system user with `whatsapp_business_messaging`.
2. Set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` (App settings → Basic) and a random `WHATSAPP_VERIFY_TOKEN`.
3. Webhook: callback URL `https://YOUR-DOMAIN/api/whatsapp/webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`, then subscribe to the **messages** field.
4. Create and get approval for templates in WhatsApp Manager. Then add each one on **WhatsApp Outreach → Approved templates**, with the same name and language, the approved body, and which CRM field fills `{{1}}`, `{{2}}`…
5. Before sending a template to someone, record their opt-in on the lead page.

Meta charges per conversation; see Meta's WhatsApp pricing for Sri Lanka. Click-to-chat (Phase 1) keeps working with or without the API.

---

## Deploy to Vercel
1. Push this folder to a GitHub repository.
2. In Vercel, choose **New Project → Import** that repository (it detects Next.js on its own).
3. Add the four environment variables (mark `SUPABASE_SERVICE_ROLE_KEY` as server-only, which is the default for names without `NEXT_PUBLIC_`).
4. Deploy, then put the production URL into Supabase's Site URL and Redirect URLs, and into `NEXT_PUBLIC_SITE_URL`.

HTTPS is automatic on Vercel. Security headers (HSTS, frame-deny, nosniff) are set in `next.config.mjs`.

---

## Roles and security

| | Admin | Sales Manager | Sales Executive |
|---|---|---|---|
| See leads | All | Own, team members' and unassigned | Own only |
| Assign / reassign | ✓ | ✓ | ✗ (blocked in the database) |
| Import | ✓ | View history | ✗ |
| Export | ✓ | ✓ | ✗ |
| Delete leads | ✓ | ✗ | ✗ |
| Edit templates | ✓ | ✓ | ✗ |
| Classification rules, services, company settings | ✓ | read | read |
| Roles, teams, invitations | ✓ | view team | ✗ |
| Approve quotations | ✓ | ✓ | ✗ (blocked in the database) |

- **Row Level Security** is on for every table. These permissions are enforced by Postgres, not just hidden in the UI.
- Roles can only be changed by admins, enforced by a trigger. The role in sign-up metadata is ignored.
- **Audit log:** changes to stage, owner, mobile, value and do-not-contact on leads; every change to profiles, deals, quotations and services; exports.
- All inputs are validated on the server. Search input is sanitised before it reaches PostgREST filters.
- **Duplicate prevention:** a unique `dedupe_key` (the mobile number, or the normalised name + city when there is no mobile).
- **Rate limiting:** Supabase Auth limits login attempts by default. For extra API protection, enable Vercel Firewall rate-limit rules on `/login` and `/leads/export`.
- **Backups:** Supabase Pro includes daily backups and point-in-time recovery (recommended). On Free, run `npx supabase db dump` on a schedule and keep weekly exports of the leads.

---

## Tests

```bash
npm test
```
Unit tests for Sri Lankan phone normalisation, WhatsApp links and templates, column detection and row cleaning.

```bash
npm run test:db
```
Runs all migrations in an in-memory Postgres (PGlite) with 82 checks. Phase 3 adds WhatsApp consent rules, delivery-status ordering, AI usage limits and enrichment permissions. The rest: RLS role rules, reassignment blocking, privilege escalation, dedupe, classification, scoring, outreach statuses, do-not-contact, follow-up sync, dashboard functions, audit logging, quotation totals / approval workflow / freezing / expiry, deals, tasks, notifications and reminders.

```bash
npm run test:ai
```
Offline check of the exact request sent to the Claude API (mock, no network, no cost).

```bash
npm run typecheck
```

---

## Project structure

```
supabase/migrations/      schema, functions + RLS, seed data, Phase 2 (deals, quotations, tasks, notifications)
supabase/functions/       send-notification-emails (Edge Function, Resend)
supabase/cron.sql         optional pg_cron schedule (reminders, expiry, emails)
src/middleware.ts         session refresh + auth redirect
src/lib/                  phone (+94), whatsapp, import-mapping, leads-query, supabase clients
src/app/login             sign in / reset
src/app/(app)/…           all CRM pages (dashboard, leads, import, classification, pipeline,
                          whatsapp, tasks, quotations, analytics, team, assistant, settings)
tests/                    unit tests + database/RLS test
```

## Database tables
`organizations, profiles, services, classification_rules, lead_imports, contacts, lead_service_recommendations, deals, deal_activities, tasks, task_events, follow_ups, quotations, quotation_items, message_templates, communication_logs, notifications, audit_logs, system_settings`

Leads (the companies) live in **`contacts`**. **`organizations`** holds PIXhub's own company details for quotation headers.
