# PIXhub CRM — Windows app (.exe)

A Windows desktop app for the PIXhub Sales CRM. It opens the live CRM (https://pixhub-crm.vercel.app) in its own
window with its own icon, Start-menu and desktop shortcut, and keeps you signed in.

> The CRM itself runs in the cloud (Vercel + Supabase). This PC does **not** need to stay on — the website, the
> phone app and email campaigns keep working when your laptop is off. This .exe is just a convenient way to open it.

Features: remembers window size, stays signed in, one window only, links to WhatsApp / Maps / lead websites open in
your normal browser, downloads (CSV exports, quotation PDFs) ask where to save, offline screen with "Try again".
Shortcuts: Ctrl+D Dashboard, Ctrl+L Leads, Ctrl+T Tasks, Alt+←/→ back/forward, Ctrl +/- zoom.

## Build the .exe

```bash
cd desktop
npm install
npm run dist
```

Output in `desktop/dist/`:
- `PIXhub-CRM-1.0.0-x64-nsis.exe` — installer (Start menu + desktop shortcut)
- `PIXhub-CRM-1.0.0-portable.exe` — single file, runs without installing

Run without building: `npm start`.

Windows SmartScreen may say "unrecognized app" because the .exe isn't code-signed — click **More info → Run anyway**.
(A code-signing certificate removes this warning.)
