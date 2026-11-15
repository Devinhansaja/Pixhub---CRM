# PIXhub CRM — iPhone & Android app

A native mobile app (React Native + Expo, TypeScript) for the PIXhub Sales CRM. It uses the **same Supabase
database and the same logins** as the web CRM at https://pixhub-crm.vercel.app, so everything you do on the
phone shows up on the web and vice versa. Row Level Security decides what each user can see — a sales
executive only sees their own leads, managers and admins see everything.

> The CRM runs in the cloud (Vercel + Supabase). Your laptop does **not** need to be on for the app,
> the website or the email campaigns to work.

## What's in the app

| Area | What you can do |
|---|---|
| **Dashboard** | Key numbers (leads, qualified, interested, won, revenue, pipeline), today's follow-ups and tasks, leads by stage and district |
| **Leads** | Search (company, person, phone, email), filter by stage / district / contact info / owner, sort, infinite scroll, add new leads |
| **Lead page** | One-tap Call, WhatsApp, Email, Website, Facebook, Maps · change stage · assign (managers) · notes · schedule follow-ups · tasks · quotations · “They replied” (stops email follow-ups) · recommended services · explainable score · activity timeline |
| **Pipeline** | Kanban board (columns side-by-side on tablets, one stage at a time on phones); long-press a lead to move it |
| **Tasks** | Today & overdue / upcoming / done, tasks + follow-ups, tick to complete, create tasks, comments |
| **Quotations** | List, create from PIXhub services, submit / approve / request changes / mark sent / accepted / rejected, **PDF generated on the phone and shared** (WhatsApp, email, Files) |
| **Email campaigns** (managers) | Progress stats, approve, request changes, pause, resume, change speed & sending hours, cancel |
| **Analytics, Team, Notifications, Profile** | Reports, team performance, in-app notifications with unread badge, change name/phone/password |

Big-screen jobs (Excel import, classification rules, writing new campaigns, services & prices) open the web CRM.

Honest outreach logging: opening WhatsApp is recorded as *“chat opened (not confirmed sent)”*, and leads marked
**Do not contact** can't be called / messaged from the app.

## Project structure

```
mobile/
├── app.json            Expo config (name, icons, bundle ids lk.pixhub.crm, plugins)
├── eas.json            EAS Build profiles: development, preview (APK), production (store)
├── .env.example        EXPO_PUBLIC_SUPABASE_URL / ANON_KEY / WEB_URL
├── assets/             App icon, Android adaptive icon, splash
└── src/
    ├── app/            Screens (Expo Router — every file is a route)
    │   ├── _layout.tsx         Providers + auth gate + stack navigator
    │   ├── login.tsx
    │   ├── (tabs)/             Dashboard, Leads, Pipeline, Tasks, More
    │   ├── lead/[id].tsx, lead/edit.tsx
    │   ├── task/[id].tsx, task/new.tsx
    │   ├── quotations/…, campaigns/…
    │   └── notifications, analytics, team, profile
    ├── components/     Reusable UI: ui.tsx (Button, Card, Input, Badge, Chips, StatCard, BarList,
    │                   PickerSheet, SelectField, ListItem, EmptyState…), Sheet, DateTimeField, LeadCard
    ├── hooks/          useData (load / refresh / refetch on focus), useResponsive (phone / tablet layouts)
    ├── lib/            supabase client, auth context, formatting, constants, lead helpers, quotation PDF
    └── theme/          Colours (light + dark mode), spacing, radius, font sizes
```

## 1. Run it on your phone (development)

Requirements: Node.js 20+ on your PC, and the phone on the same Wi-Fi.

```bash
cd mobile
npm install
cp .env.example .env.local      # then fill in the Supabase URL + anon key (already done on this PC)
npx expo start
```

This app uses native modules (date picker, PDF/print, sharing), so use a **development build** rather than Expo Go:

```bash
npx eas-cli@latest login
npx eas-cli@latest build --profile development --platform android   # installable APK with dev tools
```

Install that build on the phone, run `npx expo start`, and open the project from the dev build.

## 2. Build the real apps with EAS (no Mac / Android Studio needed)

One-time setup:

```bash
npm install -g eas-cli          # or use: npx eas-cli@latest …
eas login                       # free Expo account at https://expo.dev
eas init                        # links this folder to an Expo project (adds projectId to app.json)
```

**Android APK to share directly** (install on any Android phone, no Play Store):

```bash
eas build --profile preview --platform android
```

When it finishes, EAS gives you a link/QR code — open it on the phone and install the `.apk`.

**Store builds:**

```bash
eas build --profile production --platform android   # .aab for Google Play
eas build --profile production --platform ios       # .ipa for the App Store / TestFlight
eas submit --platform android                       # upload to Google Play (needs a Play Console account)
eas submit --platform ios                           # upload to App Store Connect (needs Apple Developer account)
```

iPhone notes: Apple only allows installing apps through the App Store, TestFlight, or registered test devices.
You need an **Apple Developer account (USD 99/year)**. EAS creates the certificates for you during `eas build`.
For quick testing on your own iPhone: `eas device:create` (register it) then `eas build --profile preview --platform ios`.

## 3. Updating the app

- Change version in `app.json` (`version`) for a new store release; build numbers auto-increment (`appVersionSource: remote`).
- JavaScript-only fixes can be shipped instantly with EAS Update: `npx expo install expo-updates`, `eas update:configure`, then `eas update --branch production`.

## Configuration

| Variable | Where | Value |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `.env.local` and `eas.json` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` and `eas.json` | Supabase **anon** (public) key — never the service-role key |
| `EXPO_PUBLIC_WEB_URL` | `.env.local` and `eas.json` | https://pixhub-crm.vercel.app |

## Checks

```bash
npx tsc --noEmit        # typecheck
npx expo-doctor         # dependency / config check
```
