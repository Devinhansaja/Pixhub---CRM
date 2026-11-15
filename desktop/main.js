// PIXhub CRM for Windows — a desktop window around the live CRM (https://pixhub-crm.vercel.app).
// The CRM runs on Vercel + Supabase, so this PC does NOT need to stay on for the CRM to work.
const { app, BrowserWindow, Menu, shell, session } = require("electron");
const path = require("path");
const fs = require("fs");

const CRM_URL = process.env.PIXHUB_CRM_URL || "https://pixhub-crm.vercel.app";
const CRM_ORIGIN = new URL(CRM_URL).origin;
const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

let win = null;

function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), "utf8")); } catch { return { width: 1360, height: 860 }; }
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch { /* ignore */ }
}

function offlinePage(reason) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>PIXhub CRM</title><style>
    body{margin:0;height:100vh;display:grid;place-items:center;background:#0b1b3f;color:#e2e8f0;font-family:Segoe UI,Arial,sans-serif}
    .c{text-align:center;max-width:420px;padding:24px} .l{width:64px;height:64px;border-radius:16px;background:#2563eb;display:grid;place-items:center;font-size:32px;font-weight:700;margin:0 auto 16px}
    button{margin-top:20px;background:#2563eb;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:15px;cursor:pointer} p{color:#94a3b8}
  </style></head><body><div class="c"><div class="l">P</div><h2>Can't reach PIXhub CRM</h2>
  <p>Check your internet connection and try again.</p><p style="font-size:12px">${String(reason).replace(/[<>&]/g, "")}</p>
  <button onclick="location.href='${CRM_URL}'">Try again</button></div></body></html>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

function createWindow() {
  const s = loadState();
  win = new BrowserWindow({
    width: s.width || 1360, height: s.height || 860, x: s.x, y: s.y, minWidth: 380, minHeight: 560,
    title: "PIXhub CRM", backgroundColor: "#0b1b3f", show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      partition: "persist:pixhub",          // stay signed in between launches
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true,
    },
  });
  if (s.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  ["resize", "move", "close"].forEach((ev) => win.on(ev, saveState));

  // Links to other sites (WhatsApp, Google Maps, lead websites, mailto:) open in the normal browser / app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(CRM_ORIGIN)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith(CRM_ORIGIN) || url.startsWith("data:")) return;
    e.preventDefault();
    shell.openExternal(url);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) win.loadURL(offlinePage(`${desc} (${code})`));
  });

  win.loadURL(CRM_URL);
}

function buildMenu() {
  const template = [
    { label: "PIXhub CRM", submenu: [
      { label: "Dashboard", accelerator: "CmdOrCtrl+D", click: () => win?.loadURL(`${CRM_URL}/dashboard`) },
      { label: "Leads", accelerator: "CmdOrCtrl+L", click: () => win?.loadURL(`${CRM_URL}/leads`) },
      { label: "Tasks", accelerator: "CmdOrCtrl+T", click: () => win?.loadURL(`${CRM_URL}/tasks`) },
      { type: "separator" },
      { label: "Open in web browser", click: () => win && shell.openExternal(win.webContents.getURL().startsWith("http") ? win.webContents.getURL() : CRM_URL) },
      { type: "separator" },
      { role: "quit" },
    ] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [
      { label: "Back", accelerator: "Alt+Left", click: () => win?.webContents.navigationHistory.canGoBack() && win.webContents.navigationHistory.goBack() },
      { label: "Forward", accelerator: "Alt+Right", click: () => win?.webContents.navigationHistory.canGoForward() && win.webContents.navigationHistory.goForward() },
      { role: "reload" }, { type: "separator" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "togglefullscreen" },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// One window only: launching again focuses the existing one
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    app.setAppUserModelId("lk.pixhub.crm");
    // Only allow notifications and clipboard for the CRM; deny camera, mic, location etc.
    session.fromPartition("persist:pixhub").setPermissionRequestHandler((wc, permission, cb) => {
      cb(wc.getURL().startsWith(CRM_ORIGIN) && ["notifications", "clipboard-sanitized-write", "clipboard-read"].includes(permission));
    });
    buildMenu();
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
