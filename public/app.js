import { icon, FILE_ICONS, LUCIDE } from "./icons.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

const apiPresets = window.__PRESETS__ || [];

/* ----- branding (instance-level, admin-configurable) ----- */
let brand = { name: "Telegram Drive", accent: "#4f8cff", logo: "", tagline: "Secure file sharing", copyright: "" };
const CREDIT_HREF = "https://linktr.ee/thesamgfx";
const CREDIT_HTML = `Telegram Web Drive Made with <span class="heart">&hearts;</span> by <a class="credit-name" href="${CREDIT_HREF}" target="_blank" rel="noopener">Samer Ahmed</a>`;
function hexShade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "#4f8cff"));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c * amt : (255 - c) * amt))));
  return "#" + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
}
function hexRgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "#4f8cff"));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function applyBranding() {
  const root = document.documentElement.style;
  root.setProperty("--accent", brand.accent);
  root.setProperty("--accent-2", hexShade(brand.accent, -0.16));
  root.setProperty("--accent-soft", hexRgba(brand.accent, 0.14));
  root.setProperty("--accent-glow", hexRgba(brand.accent, 0.4));
  if (brand.name) document.title = brand.name;
  const tm = document.querySelector('meta[name="theme-color"]');
  if (tm) tm.setAttribute("content", brand.accent);
  setFavicon(brand.accent);
}
function setFavicon(accent) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='15' fill='${accent}'/><g fill='none' stroke='white' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'><path d='M44 40H24a9 9 0 1 1 8.6-11.6h2.3a5.8 5.8 0 1 1 0 11.6Z'/></g></svg>`;
  let link = document.querySelector("link[rel~='icon']");
  if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
  link.href = "data:image/svg+xml," + encodeURIComponent(svg);
}
async function loadBranding() {
  try {
    brand = { ...brand, ...(await api("/api/branding")) };
  } catch {}
  applyBranding();
}
const brandMark = (size) =>
  brand.logo ? `<img class="brand-logo-img" src="${esc(brand.logo)}" alt="" width="${size}" height="${size}" />` : icon("cloud", { size, cls: "brand-logo" });
const brandName = () => esc(brand.name || "Telegram Drive");
const brandFootCopyright = () => brand.copyright ? brand.copyright : `© ${new Date().getFullYear()} ${brand.name || "Telegram Drive"}`;

const fileIcon = (kind, size = 40) => {
  const f = FILE_ICONS[kind] || FILE_ICONS.file;
  return `<span class="ft ${f.c}">${icon(f.i, { size })}</span>`;
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    let msg = res.statusText || "Request failed";
    if (ct.includes("json")) {
      const j = await res.json().catch(() => ({}));
      const err = new Error(j.error || msg);
      err.status = res.status;
      err.data = j;
      throw err;
    }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  if (ct.includes("json")) return res.json();
  return res;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtSize(n) {
  if (n == null || isNaN(n)) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) (n /= 1024), i++;
  return (i === 0 ? n : n.toFixed(1)) + " " + u[i];
}
function fmtDate(t) {
  if (!t) return "";
  return new Date(t * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/* ===================== state ===================== */
const state = {
  auth: null,
  user: null,
  accounts: [],
  currentAccountId: null,
  folders: [],
  currentFolder: null,
  view: localStorage.getItem("tg.view") || "grid",
  files: [],
  selected: new Set(),
  search: "",
  offsetId: 0,
  loading: false,
  sidebarOpen: false,
};

function theme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("tg.theme", t);
}
theme(localStorage.getItem("tg.theme") || "dark");

/* ===================== boot ===================== */
async function boot() {
  await loadBranding();
  const path = location.pathname;
  const m = path.match(/^\/s\/([A-Za-z0-9]+)/);
  if (m) return renderPublicShare(m[1]);

  $("#app").innerHTML = `<div class="center-load"><div class="spinner"></div></div>`;
  try {
    state.auth = await api("/api/auth/state");
  } catch {
    return renderError("Cannot reach the server.");
  }
  if (state.auth.needsSetup) return renderSetup();
  if (!state.auth.loggedIn) return renderLogin();
  state.user = state.auth.user;
  state.accounts = state.auth.accounts;
  state.currentAccountId = state.auth.currentAccountId || state.accounts[0]?.id || null;
  if (state.currentAccountId && state.auth.currentAccountId == null) {
    await api("/api/accounts/switch/" + state.currentAccountId, { method: "POST" });
  }
  if (!state.accounts.length) {
    return state.user?.isAdmin ? renderConnect() : renderNoAccounts();
  }
  renderApp();
  await loadFolders();
}

function renderNoAccounts() {
  $("#app").innerHTML = authShell("No drive connected", "An administrator needs to connect a Telegram account before you can browse files.", `<button class="primary block" onclick="logout()">${icon("logout", { size: 16 })} Log out</button>`);
}

function renderError(msg) {
  $("#app").innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="auth-head">${icon("alert", { size: 30, cls: "err-ic" })}<h1>Something went wrong</h1></div><p class="sub">${esc(msg)}</p><button class="primary" onclick="location.reload()">${icon("refresh", { size: 16 })} Retry</button></div></div>`;
}

/* ===================== auth screens ===================== */
function authShell(head, sub, bodyHtml) {
  return `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-brand">${brandMark(34)}</div>
    <div class="auth-head"><h1>${head}</h1></div>
    <p class="sub">${sub}</p>
    ${bodyHtml}
  </div></div>`;
}

function renderSetup() {
  $("#app").innerHTML = authShell("Welcome", "Create the admin account to manage this drive.", `
  <form id="setupForm">
    <div class="field"><label>Admin username</label>
      <div class="input-wrap">${icon("user", { size: 16, cls: "lead" })}<input id="un" value="admin" required autocomplete="username" autofocus placeholder="admin" /></div></div>
    <div class="field"><label>Admin password</label>
      <div class="input-wrap">${icon("lock", { size: 16, cls: "lead" })}<input type="password" id="pw" required minlength="4" autocomplete="new-password" placeholder="Choose a password" /></div></div>
    <div class="field"><label>Confirm password</label>
      <div class="input-wrap">${icon("lock", { size: 16, cls: "lead" })}<input type="password" id="pw2" required minlength="4" placeholder="Repeat password" /></div></div>
    <div class="err" id="err"></div>
    <button class="primary block" type="submit">${icon("shield", { size: 16 })} Create &amp; continue</button>
    <p class="hint">This admin account gates access to the drive and can create other users.</p>
  </form>`);
  $("#setupForm").onsubmit = async (e) => {
    e.preventDefault();
    const p = $("#pw").value,
      p2 = $("#pw2").value;
    if (p !== p2) return ($("#err").textContent = "Passwords do not match");
    try {
      await api("/api/auth/setup", { method: "POST", body: JSON.stringify({ username: $("#un").value.trim(), password: p }) });
      boot();
    } catch (err) {
      $("#err").textContent = err.message;
    }
  };
}

function renderLogin() {
  $("#app").innerHTML = authShell("Welcome back", "Sign in to your drive.", `
  <form id="loginForm">
    <div class="field"><label>Username</label>
      <div class="input-wrap">${icon("user", { size: 16, cls: "lead" })}<input id="un" required autofocus autocomplete="username" placeholder="username" /></div></div>
    <div class="field"><label>Password</label>
      <div class="input-wrap">${icon("lock", { size: 16, cls: "lead" })}<input type="password" id="pw" required autocomplete="current-password" placeholder="Your password" /></div></div>
    <div class="err" id="err"></div>
    <button class="primary block" type="submit">${icon("logout", { size: 16, cls: "flip" })} Sign in</button>
  </form>`);
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: $("#un").value, password: $("#pw").value }) });
      boot();
    } catch (err) {
      $("#err").textContent = err.message;
    }
  };
}

/* ===================== connect Telegram ===================== */
function renderConnect() {
  const accs = state.accounts
    .map(
      (a) => `<div class="account-pill">${a.premium ? icon("zap", { size: 14, cls: "gold" }) : ""}<b>${esc(a.label)}</b> <span class="muted">${esc(a.phone || a.username || "")}</span></div>`
    )
    .join("");
  $("#app").innerHTML = authShell("Connect Telegram", "Your Telegram account becomes the storage backend.", `
  ${accs ? `<div class="acc-list">${accs}</div>` : ""}
  <form id="connForm">
    <div class="field">
      <label>API credentials ${apiPresets.length ? "(or pick a preset)" : ""}</label>
      ${apiPresets.length ? `<select id="preset" class="mb"><option value="">Enter my own…</option>${apiPresets.map((p, i) => `<option value="${i}">Preset ${i + 1}</option>`).join("")}</select>` : ""}
      <div class="row">
        <div class="input-wrap">${icon("keyRound", { size: 16, cls: "lead" })}<input id="apiId" placeholder="api_id" inputmode="numeric" required /></div>
        <div class="input-wrap">${icon("keyRound", { size: 16, cls: "lead" })}<input id="apiHash" placeholder="api_hash" required /></div>
      </div>
    </div>
    <div class="field"><label>Phone number</label>
      <div class="input-wrap">${icon("phone", { size: 16, cls: "lead" })}<input id="phone" placeholder="+1 555 000 0000" required /></div></div>
    <div class="err" id="err"></div>
    <button class="primary block" type="submit">${icon("send", { size: 16 })} Send login code</button>
    <p class="hint">Get your <b>api_id</b> and <b>api_hash</b> from <a href="https://my.telegram.org/apps" target="_blank" rel="noopener">my.telegram.org/apps</a>. Stored only on this server.</p>
  </form>`);
  if (apiPresets.length)
    $("#preset").onchange = (e) => {
      const p = apiPresets[e.target.value];
      $("#apiId").value = p ? p.id : "";
      $("#apiHash").value = p ? p.hash : "";
    };
  $("#connForm").onsubmit = async (e) => {
    e.preventDefault();
    $("#err").textContent = "";
    const body = { apiId: $("#apiId").value.trim(), apiHash: $("#apiHash").value.trim(), phone: $("#phone").value.trim() };
    try {
      const r = await api("/api/auth/tg/request", { method: "POST", body: JSON.stringify(body) });
      renderCodeStep(body, r.tempToken, r.isCodeViaApp);
    } catch (err) {
      $("#err").textContent = err.message;
    }
  };
}

function renderCodeStep(creds, tempToken, isCodeViaApp) {
  $("#app").innerHTML = authShell("Enter the code", `We sent a code${isCodeViaApp ? " in your Telegram app" : " via SMS/Telegram"} to ${esc(creds.phone)}.`, `
  <form id="codeForm">
    <div class="field"><label>Login code</label>
      <div class="input-wrap">${icon("shield", { size: 16, cls: "lead" })}<input id="code" inputmode="numeric" required autofocus placeholder="12345" /></div></div>
    <div class="err" id="err"></div>
    <button class="primary block" type="submit">${icon("check", { size: 16 })} Sign in</button>
    <button type="button" class="link-btn" id="resendBtn">${icon("refresh", { size: 14 })} Resend code</button>
  </form>`);
  $("#resendBtn").onclick = async () => {
    try {
      await api("/api/auth/tg/resend", { method: "POST", body: JSON.stringify({ tempToken }) });
      $("#err").textContent = "";
      $("#code").value = "";
      $("#code").focus();
    } catch (err) {
      $("#err").textContent = err.message;
    }
  };
  $("#codeForm").onsubmit = async (e) => {
    e.preventDefault();
    $("#err").textContent = "";
    try {
      await api("/api/auth/tg/code", { method: "POST", body: JSON.stringify({ tempToken, code: $("#code").value.trim() }) });
      finishConnect();
    } catch (err) {
      if (err.status === 449 || err.data?.needPassword) return renderPasswordStep(creds, tempToken);
      $("#err").textContent = err.message;
    }
  };
}

function renderPasswordStep(creds, tempToken) {
  $("#app").innerHTML = authShell("Two-factor password", "Your Telegram account has cloud 2FA enabled.", `
  <form id="pwForm">
    <div class="field"><label>Cloud password</label>
      <div class="input-wrap">${icon("lock", { size: 16, cls: "lead" })}<input type="password" id="password" required autofocus placeholder="2FA password" /></div></div>
    <div class="err" id="err"></div>
    <button class="primary block" type="submit">${icon("check", { size: 16 })} Unlock</button>
  </form>`);
  $("#pwForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/api/auth/tg/password", { method: "POST", body: JSON.stringify({ tempToken, password: $("#password").value }) });
      finishConnect();
    } catch (err) {
      $("#err").textContent = err.message;
    }
  };
}

async function finishConnect() {
  state.auth = await api("/api/auth/state");
  state.user = state.auth.user;
  state.accounts = state.auth.accounts;
  state.currentAccountId = state.auth.currentAccountId;
  boot();
}

/* ===================== main app shell ===================== */
function renderApp() {
  $("#app").innerHTML = `
  <div class="layout" id="layout">
    <div class="scrim" onclick="toggleSidebar(false)"></div>
    <aside class="sidebar">
      <div class="brand">${brandMark(22)}<span class="brand-name">${brandName()}</span></div>
      <div class="nav" id="nav"></div>
      <div id="acctArea"></div>
    </aside>
    <main class="main">
      <div class="topbar">
        <button class="icon-btn menu-btn" id="menuBtn" title="Menu">${icon("menu")}</button>
        <div class="title" id="title">—</div>
        <div class="searchbox">${icon("search", { size: 16, cls: "lead" })}<input class="search" id="search" placeholder="Search files…" /></div>
        <div class="actions" id="topActions"></div>
      </div>
      <div class="content" id="content"></div>
      <footer class="dash-foot">${CREDIT_HTML}</footer>
    </main>
  </div>`;
  $("#menuBtn").onclick = () => toggleSidebar(!state.sidebarOpen);
  $("#search").oninput = (e) => {
    state.search = e.target.value.trim();
    clearTimeout(window.__st);
    window.__st = setTimeout(() => loadFiles(true), 350);
  };
  renderSidebar();
}
window.toggleSidebar = (v) => {
  state.sidebarOpen = v;
  $("#layout")?.classList.toggle("open", v);
};

function renderSidebar() {
  const nav = $("#nav");
  if (!nav) return;
  const folders = state.folders
    .map((f) => {
      const active = state.currentFolder === f.id;
      const ic = f.kind === "saved" ? "inbox" : "folder";
      return `<div class="nav-item ${active ? "active" : ""}" data-folder="${f.id}" title="${esc(f.title)}">
        ${icon(ic, { size: 18 })}<span class="nm">${esc(f.title)}</span>${active ? icon("check", { size: 14, cls: "ml" }) : ""}</div>`;
    })
    .join("");
  const libItem = (v, label, ic) => `<div class="nav-item ${state.currentView === v ? "active" : ""}" data-view="${v}">${icon(ic, { size: 18 })}<span class="nm">${label}</span></div>`;
  const isAdmin = !!state.user?.isAdmin;
  nav.innerHTML = `
    <div class="sec">Folders ${isAdmin ? `<button class="mini" onclick="newFolder()">${icon("plus", { size: 13 })} New</button>` : ""}</div>
    ${folders || `<div class="nav-muted">No folders</div>`}
    <div class="sec">Library</div>
    ${libItem("shares", "Share links", "share")}
    ${isAdmin ? libItem("keys", "API keys", "key") : ""}
    ${isAdmin ? libItem("users", "Users", "users") : ""}
    ${libItem("settings", "Settings", "settings")}
    <div class="sec">Theme</div>
    <div class="theme-row">
      <button class="seg ${theme.current === "dark" ? "on" : ""}" onclick="setTheme('dark')">${icon("moon", { size: 15 })}</button>
      <button class="seg ${theme.current === "light" ? "on" : ""}" onclick="setTheme('light')">${icon("sun", { size: 15 })}</button>
    </div>`;
  $$(".nav-item[data-folder]", nav).forEach((n) => (n.onclick = () => openFolder(n.dataset.folder)));
  $$(".nav-item[data-view]", nav).forEach((n) => (n.onclick = () => openView(n.dataset.view)));

  const acc = state.accounts.find((a) => a.id === state.currentAccountId);
  $("#acctArea").innerHTML = `
    <div class="account-card">
      <div class="acct-top">${icon("user", { size: 18 })}<div class="acct-info"><div class="acct-nm">${acc?.premium ? icon("zap", { size: 12, cls: "gold" }) : ""} ${esc(acc?.label || "No account")}</div><div class="acct-ph">${esc(state.user?.username || "")} · ${state.user?.isAdmin ? "admin" : "user"}${acc?.phone ? " · " + esc(acc.phone) : ""}</div></div></div>
      <div class="acct-actions">
        ${isAdmin ? `<button class="sm" onclick="addAccount()">${icon("userPlus", { size: 14 })} Account</button>` : ""}
        <button class="sm ghost" onclick="logout()">${icon("logout", { size: 14 })}</button>
      </div>
    </div>`;
}
theme.current = localStorage.getItem("tg.theme") || "dark";
window.setTheme = (t) => {
  theme.current = t;
  theme(t);
  renderSidebar();
};

async function loadFolders() {
  try {
    const r = await api("/api/folders");
    state.folders = r.folders;
    if (!state.currentFolder && state.folders.length) await openFolder(state.folders[0].id);
    else renderSidebar();
  } catch (err) {
    content().innerHTML = emptyHtml(err.message, "alert");
  }
}

async function openFolder(id) {
  state.currentFolder = id;
  state.currentView = null;
  state.selected.clear();
  toggleSidebar(false);
  const f = state.folders.find((x) => x.id === id);
  $("#search").value = "";
  state.search = "";
  renderSidebar();
  $("#title").innerHTML = `${icon(f?.kind === "saved" ? "inbox" : "folder", { size: 18 })} ${esc(f?.title || "Drive")}`;
  $("#topActions").innerHTML = `
    <button class="icon-btn" id="viewToggle" title="Toggle view">${icon(state.view === "grid" ? "list" : "grid")}</button>
    <button class="icon-btn" id="newFolderBtn" title="New folder">${icon("folderPlus")}</button>
    <button class="icon-btn" id="shareFolderBtn" title="Share whole folder">${icon("share")}</button>
    <button class="primary" id="uploadBtn">${icon("uploadCloud", { size: 16 })} <span>Upload</span></button>`;
  $("#viewToggle").onclick = () => {
    state.view = state.view === "grid" ? "list" : "grid";
    localStorage.setItem("tg.view", state.view);
    $("#viewToggle").innerHTML = icon(state.view === "grid" ? "list" : "grid");
    renderFiles();
  };
  $("#newFolderBtn").onclick = newFolder;
  $("#shareFolderBtn").onclick = () => shareFolderModal(f);
  $("#uploadBtn").onclick = pickUpload;
  await loadFiles(true);
}

function content() {
  return $("#content");
}

async function loadFiles(reset) {
  if (!state.currentFolder) return;
  if (reset) {
    state.offsetId = 0;
    state.files = [];
    content().innerHTML = `<div class="center-load"><div class="spinner"></div></div>`;
  }
  state.loading = true;
  try {
    const r = await api(`/api/files?folder=${state.currentFolder}&limit=60${state.offsetId ? `&offsetId=${state.offsetId}` : ""}${state.search ? `&search=${encodeURIComponent(state.search)}` : ""}`);
    state.files = reset ? r.items : [...state.files, ...r.items];
    state.offsetId = r.nextOffset;
    renderFiles();
  } catch (err) {
    content().innerHTML = emptyHtml(err.message, "alert");
  } finally {
    state.loading = false;
  }
}

function renderFiles() {
  const c = content();
  if (!state.files.length) {
    c.innerHTML = emptyHtml(state.search ? "No files match your search." : "This folder is empty", state.search ? "search" : "uploadCloud", state.search ? "" : `<button class="primary" onclick="pickUpload()">${icon("uploadCloud", { size: 16 })} Upload files</button>`);
    return;
  }
  const selInfo = state.selected.size ? `<span class="sel-info">${icon("check", { size: 13 })} ${state.selected.size} selected</span>` : "";
  const allSel = state.files.length && state.selected.size === state.files.length;
  const selAllBtn = `<button class="btn-2 ghost" onclick="toggleSelectAll()">${allSel ? icon("x", { size: 14 }) + " Clear all" : icon("check", { size: 14 }) + " Select all"}</button>`;
  const toolbar = `<div class="toolbar-row">${selInfo}${selAllBtn}<div class="spacer"></div>${
    state.selected.size
      ? `<button class="btn-2" onclick="downloadSelected()">${icon("download", { size: 15 })} Download</button><button class="btn-2" onclick="shareSelected()">${icon("share", { size: 15 })} Share</button><button class="btn-2 danger" onclick="deleteSelected()">${icon("trash", { size: 15 })} Delete</button><button class="btn-2 ghost" onclick="clearSelection()">Clear</button>`
      : ``
  }</div>`;
  const rowActions = (id) =>
    `<div class="row-actions"><button class="ca-btn" title="Download" onclick="event.stopPropagation();downloadFileById(${id})">${icon("download", { size: 15 })}</button><button class="ca-btn" title="Share" onclick="event.stopPropagation();shareById(${id})">${icon("share", { size: 15 })}</button><button class="ca-btn danger" title="Delete" onclick="event.stopPropagation();deleteFileById(${id})">${icon("trash", { size: 15 })}</button></div>`;
  const list =
    state.view === "grid"
      ? `<div class="grid">${state.files.map(fileCard).join("")}</div>`
      : `<div class="list">${state.files
          .map(
            (f) => `<div class="row ${state.selected.has(f.id) ? "selected" : ""}" data-id="${f.id}">
        <div class="row-ic">${fileIcon(f.kind, 20)}</div>
        <div class="row-main"><div class="row-nm">${esc(f.caption || f.name)}</div><div class="row-sub">${fmtSize(f.size)} · ${fmtDate(f.date)}</div></div>
        <div class="row-ext">${esc(f.ext || "")}</div>
        ${rowActions(f.id)}
      </div>`
          )
          .join("")}</div>`;
  const more = state.offsetId ? `<div class="load-more"><button class="btn-2" onclick="loadFiles(false)">${icon("chevronRight", { size: 14, cls: "down" })} Load more</button></div>` : "";
  c.innerHTML = toolbar + list + more;
  $$(".card, .list .row", c).forEach((node) => {
    const id = Number(node.dataset.id);
    node.onclick = (e) => {
      if (e.shiftKey || e.ctrlKey || e.metaKey || state.bulkMode) toggleSelect(id);
      else previewFile(id);
    };
    node.oncontextmenu = (e) => {
      e.preventDefault();
      toggleSelect(id);
    };
  });
}

function fileCard(f) {
  const sel = state.selected.has(f.id) ? "selected" : "";
  const ar = f.width && f.height ? ` style="aspect-ratio:${f.width}/${f.height}"` : "";
  const showImg = f.kind === "image" || f.kind === "video";
  const thumb = `${fileIcon(f.kind, 40)}${showImg ? `<img class="thumb-img" loading="lazy" src="/api/files/${f.id}/thumb?folder=${state.currentFolder}" onload="this.parentNode.classList.add('has-img')" onerror="this.remove()" alt="" />` : ""}`;
  const badge = f.kind === "video" ? `<span class="play-badge">${icon("play", { size: 12 })}</span>` : "";
  const actions = `<div class="card-actions"><button class="ca-btn" title="Download" onclick="event.stopPropagation();downloadFileById(${f.id})">${icon("download", { size: 15 })}</button><button class="ca-btn" title="Share" onclick="event.stopPropagation();shareById(${f.id})">${icon("share", { size: 15 })}</button><button class="ca-btn danger" title="Delete" onclick="event.stopPropagation();deleteFileById(${f.id})">${icon("trash", { size: 15 })}</button></div>`;
  return `<div class="card ${sel}" data-id="${f.id}">
    <div class="card-sel">${icon("check", { size: 13 })}</div>
    ${actions}
    <div class="thumb"${ar}>${thumb}${badge}</div>
    <div class="meta"><div class="nm" title="${esc(f.caption || f.name)}">${esc(f.caption || f.name)}</div><div class="sz">${fmtSize(f.size)} · ${fmtDate(f.date)}</div></div>
  </div>`;
}

function emptyHtml(msg, ic = "folder", action = "") {
  return `<div class="empty"><div class="empty-ic">${icon(ic, { size: 40 })}</div><div class="empty-msg">${msg}</div>${action}</div>`;
}

/* selection */
function toggleSelect(id) {
  state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  renderFiles();
}
window.toggleSelect = toggleSelect;
window.clearSelection = () => {
  state.selected.clear();
  renderFiles();
};
window.toggleSelectAll = () => {
  if (state.files.length && state.selected.size === state.files.length) state.selected.clear();
  else state.files.forEach((f) => state.selected.add(f.id));
  renderFiles();
};
const fileById = (id) => state.files.find((f) => f.id === id);
window.downloadFileById = (id) => {
  const f = fileById(id);
  if (f) downloadFile(f);
};
window.shareById = (id) => {
  const f = fileById(id);
  if (f) shareModal(f);
};
window.renameById = (id) => {
  const f = fileById(id);
  if (f) renameModal(f);
};
window.deleteFileById = async (id) => {
  const f = fileById(id);
  if (!f) return;
  if (!confirm(`Delete ${esc(f.name || "this file")}? This cannot be undone.`)) return;
  try {
    await api(`/api/files?folder=${state.currentFolder}`, { method: "DELETE", body: JSON.stringify({ ids: [id] }) });
    state.selected.delete(id);
    await loadFiles(true);
    toast("File deleted");
  } catch (err) {
    alert(err.message);
  }
};
window.downloadSelected = () => state.files.filter((f) => state.selected.has(f.id)).forEach(downloadFile);
window.deleteSelected = async () => {
  if (!confirm(`Delete ${state.selected.size} file(s) from Telegram? This cannot be undone.`)) return;
  try {
    await api(`/api/files?folder=${state.currentFolder}`, { method: "DELETE", body: JSON.stringify({ ids: [...state.selected] }) });
    state.selected.clear();
    await loadFiles(true);
  } catch (err) {
    alert(err.message);
  }
};
window.shareSelected = () => {
  const f = state.files.find((x) => state.selected.has(x.id));
  if (f) shareModal(f);
};

function downloadFile(f) {
  const a = document.createElement("a");
  a.href = `/api/files/${f.id}/download?folder=${state.currentFolder}`;
  a.download = f.name || "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ===================== preview ===================== */
function previewFile(id) {
  const f = state.files.find((x) => x.id === id);
  if (!f) return;
  const url = `/api/files/${f.id}/raw?folder=${state.currentFolder}`;
  let body = "";
  if (f.kind === "image") body = `<img src="${url}" alt="" />`;
  else if (f.kind === "video") body = `<video src="${url}" controls autoplay></video>`;
  else if (f.kind === "audio") body = `<div class="audio-wrap">${fileIcon("audio", 56)}<audio src="${url}" controls autoplay></audio></div>`;
  else if (f.kind === "pdf") body = `<iframe class="pdf" src="${url}"></iframe>`;
  else body = `<div class="no-prev">${fileIcon(f.kind, 56)}<div class="np-msg">No preview available</div><button class="primary" onclick="downloadFile(window.__pf)">${icon("download", { size: 16 })} Download</button></div>`;
  window.__pf = f;
  const modal = el(`<div class="modal-bg" id="pmodal">
    <div class="modal wide">
      <div class="head"><div class="t">${fileIcon(f.kind, 18)} ${esc(f.caption || f.name)}</div>
        <button class="icon-btn" onclick="document.getElementById('pmodal').remove()">${icon("x", { size: 18 })}</button></div>
      <div class="preview-wrap">${body}</div>
      <div class="preview-info">
        <div class="pi-main"><div class="nm">${esc(f.name)}</div><div class="sz">${fmtSize(f.size)} · ${esc(f.ext || "")}</div></div>
        <div class="spacer"></div>
        <button class="btn-2" onclick="renameModal(window.__pf)">${icon("pencil", { size: 15 })} Caption</button>
        <button class="btn-2" onclick="shareModal(window.__pf)">${icon("share", { size: 15 })} Share</button>
        <button class="primary" onclick="downloadFile(window.__pf)">${icon("download", { size: 15 })} Download</button>
      </div>
    </div></div>`);
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
  document.body.appendChild(modal);
}
window.previewFile = previewFile;
window.downloadFile = downloadFile;

/* ===================== rename ===================== */
function renameModal(f) {
  $("#pmodal")?.remove();
  const modal = el(`<div class="modal-bg"><form class="modal card-modal">
    <div class="head"><div class="t">${icon("pencil", { size: 16 })} Edit caption</div><button type="button" class="icon-btn" onclick="this.closest('.modal-bg').remove()">${icon("x", { size: 18 })}</button></div>
    <div class="body">
      <div class="field"><label>Caption (the message text)</label>
        <div class="input-wrap">${icon("pencil", { size: 16, cls: "lead" })}<input id="cap" value="${esc(f.caption || "")}" autofocus /></div></div>
      <div class="err" id="err"></div>
      <div class="form-actions"><button type="button" class="btn-2 ghost" onclick="this.closest('.modal-bg').remove()">Cancel</button><button class="primary" type="submit">${icon("check", { size: 15 })} Save</button></div>
    </div></form></div>`);
  modal.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api(`/api/files/${f.id}?folder=${state.currentFolder}`, { method: "PATCH", body: JSON.stringify({ caption: modal.querySelector("#cap").value }) });
      f.caption = modal.querySelector("#cap").value;
      modal.remove();
      renderFiles();
    } catch (err) {
      modal.querySelector("#err").textContent = err.message;
    }
  };
  document.body.appendChild(modal);
}
window.renameModal = renameModal;

/* ===================== share ===================== */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
window.copyText = copyText;

function shareModal(f) {
  const modal = el(`<div class="modal-bg"><div class="modal card-modal">
    <div class="head"><div class="t">${icon("share", { size: 16 })} Share link</div><button type="button" class="icon-btn" onclick="this.closest('.modal-bg').remove()">${icon("x", { size: 18 })}</button></div>
    <div class="body" id="shareBody"></div>
  </div></div>`);
  document.body.appendChild(modal);
  const bodyEl = () => modal.querySelector("#shareBody");

  function showLink(url, meta) {
    bodyEl().innerHTML = `
      <div class="share-file">${fileIcon(f.kind, 22)}<div><div class="nm">${esc(f.name)}</div><div class="sz">${fmtSize(f.size)}</div></div></div>
      <div class="field"><label>${icon("link", { size: 13 })} Link</label>
        <div class="copy-row"><input id="shareUrl" readonly value="${esc(url)}" /><button class="btn-2" id="copyShareBtn" title="Copy">${icon("copy", { size: 15 })} Copy</button></div>
      </div>
      <div class="share-meta">${meta.password ? icon("lock", { size: 13 }) + " Password protected" : icon("eye", { size: 13 }) + " Public"} · ${meta.downloads || 0} downloads${meta.expiresAt ? " · expires " + new Date(meta.expiresAt).toLocaleString() : ""}</div>
      <div class="form-actions">
        <button class="btn-2 danger" id="delShareBtn">${icon("trash", { size: 15 })} Delete link</button>
        <div class="spacer"></div>
        <button class="btn-2" id="newShareBtn">${icon("refresh", { size: 15 })} New link</button>
        <a class="primary" href="${esc(url)}" target="_blank" rel="noopener">${icon("externalLink", { size: 15 })} Open</a>
      </div>`;
    const input = modal.querySelector("#shareUrl");
    input.onclick = () => input.select();
    modal.querySelector("#copyShareBtn").onclick = async () => {
      const ok = await copyText(url);
      toast(ok ? "Link copied" : "Press Ctrl+C to copy");
    };
    modal.querySelector("#delShareBtn").onclick = async () => {
      if (!confirm("Delete this share link?")) return;
      try {
        await api("/api/shares/" + meta.id, { method: "DELETE" });
        modal.remove();
        toast("Link deleted");
      } catch (err) {
        alert(err.message);
      }
    };
    modal.querySelector("#newShareBtn").onclick = () => showCreate();
    copyText(url).then((ok) => ok && toast("Link copied"));
  }

  function showCreate() {
    bodyEl().innerHTML = `<form id="shareCreate">
      <div class="share-file">${fileIcon(f.kind, 22)}<div><div class="nm">${esc(f.name)}</div><div class="sz">${fmtSize(f.size)}</div></div></div>
      <div class="field"><label>${icon("lock", { size: 13 })} Password (optional)</label>
        <div class="input-wrap">${icon("lock", { size: 16, cls: "lead" })}<input id="spw" type="password" placeholder="Leave blank for public" /></div></div>
      <div class="field"><label>${icon("clock", { size: 13 })} Expires</label><select id="exp">
        <option value="">Never</option><option value="1">1 hour</option><option value="24">1 day</option><option value="168">1 week</option></select></div>
      <div class="err" id="err"></div>
      <div class="form-actions"><button type="button" class="btn-2 ghost" onclick="this.closest('.modal-bg').remove()">Cancel</button><button class="primary" type="submit">${icon("link", { size: 15 })} Create link</button></div>
    </form>`;
    modal.querySelector("#shareCreate").onsubmit = async (e) => {
      e.preventDefault();
      const pw = modal.querySelector("#spw").value;
      const exp = modal.querySelector("#exp").value || null;
      try {
        const r = await api("/api/shares", {
          method: "POST",
          body: JSON.stringify({ folder: state.currentFolder, msgId: f.id, name: f.name, mime: f.mime, size: f.size, password: pw, expiresInHours: exp }),
        });
        showLink(r.url, { id: r.id, password: !!pw, downloads: 0, expiresAt: r.expiresAt });
      } catch (err) {
        modal.querySelector("#err").textContent = err.message;
      }
    };
  }

  bodyEl().innerHTML = `<div class="center-load" style="min-height:120px"><div class="spinner"></div></div>`;
  (async () => {
    try {
      const r = await api(`/api/shares/for?folder=${state.currentFolder}&msgId=${f.id}`);
      if (r.none) showCreate();
      else showLink(r.share.url, { id: r.share.id, password: r.share.needsPassword, downloads: r.share.downloads, expiresAt: r.share.expiresAt });
    } catch {
      showCreate();
    }
  })();
}
window.shareModal = shareModal;

function shareFolderModal(folder) {
  const folderId = state.currentFolder;
  const title = folder?.title || "Folder";
  const modal = el(`<div class="modal-bg"><div class="modal card-modal">
    <div class="head"><div class="t">${icon("share", { size: 16 })} Share folder</div><button type="button" class="icon-btn" onclick="this.closest('.modal-bg').remove()">${icon("x", { size: 18 })}</button></div>
    <div class="body" id="fshareBody"></div>
  </div></div>`);
  document.body.appendChild(modal);
  const bodyEl = () => modal.querySelector("#fshareBody");

  function showLink(url, meta) {
    bodyEl().innerHTML = `
      <div class="share-file">${icon("folder", { size: 22 })}<div><div class="nm">${esc(title)}</div><div class="sz">Folder share · all files</div></div></div>
      <div class="field"><label>${icon("link", { size: 13 })} Link</label>
        <div class="copy-row"><input id="fshareUrl" readonly value="${esc(url)}" /><button class="btn-2" id="fCopyBtn">${icon("copy", { size: 15 })} Copy</button></div></div>
      <div class="share-meta">${meta.password ? icon("lock", { size: 13 }) + " Password protected" : icon("eye", { size: 13 }) + " Public"}${meta.expiresAt ? " · expires " + new Date(meta.expiresAt).toLocaleString() : ""}</div>
      <div class="form-actions"><button class="btn-2 danger" id="fDelBtn">${icon("trash", { size: 15 })} Delete link</button><div class="spacer"></div><button class="btn-2" id="fNewBtn">${icon("refresh", { size: 15 })} New link</button><a class="primary" href="${esc(url)}" target="_blank" rel="noopener">${icon("externalLink", { size: 15 })} Open</a></div>`;
    const input = modal.querySelector("#fshareUrl");
    input.onclick = () => input.select();
    modal.querySelector("#fCopyBtn").onclick = async () => toast((await copyText(url)) ? "Link copied" : "Press Ctrl+C to copy");
    modal.querySelector("#fDelBtn").onclick = async () => {
      if (!confirm("Delete this folder share?")) return;
      await api("/api/shares/" + meta.id, { method: "DELETE" });
      modal.remove();
      toast("Link deleted");
    };
    modal.querySelector("#fNewBtn").onclick = () => showCreate();
    copyText(url).then((ok) => ok && toast("Link copied"));
  }

  function showCreate() {
    bodyEl().innerHTML = `<form id="fShareCreate">
      <div class="share-file">${icon("folder", { size: 22 })}<div><div class="nm">${esc(title)}</div><div class="sz">Shares every file in this folder</div></div></div>
      <div class="field"><label>${icon("lock", { size: 13 })} Password (optional)</label>
        <div class="input-wrap">${icon("lock", { size: 16, cls: "lead" })}<input id="fspw" type="password" placeholder="Leave blank for public" /></div></div>
      <div class="field"><label>${icon("clock", { size: 13 })} Expires</label><select id="fexp"><option value="">Never</option><option value="1">1 hour</option><option value="24">1 day</option><option value="168">1 week</option></select></div>
      <div class="err" id="ferr"></div>
      <div class="form-actions"><button type="button" class="btn-2 ghost" onclick="this.closest('.modal-bg').remove()">Cancel</button><button class="primary" type="submit">${icon("link", { size: 15 })} Create link</button></div>
    </form>`;
    modal.querySelector("#fShareCreate").onsubmit = async (e) => {
      e.preventDefault();
      const pw = modal.querySelector("#fspw").value;
      const exp = modal.querySelector("#fexp").value || null;
      try {
        const r = await api("/api/shares", { method: "POST", body: JSON.stringify({ kind: "folder", folder: folderId, title, password: pw, expiresInHours: exp }) });
        showLink(r.url, { id: r.id, password: !!pw, expiresAt: r.expiresAt });
      } catch (err) {
        modal.querySelector("#ferr").textContent = err.message;
      }
    };
  }

  bodyEl().innerHTML = `<div class="center-load" style="min-height:120px"><div class="spinner"></div></div>`;
  (async () => {
    try {
      const r = await api(`/api/shares/forFolder?folder=${folderId}`);
      if (r.none) showCreate();
      else showLink(r.share.url, { id: r.share.id, password: r.share.needsPassword, expiresAt: r.share.expiresAt });
    } catch {
      showCreate();
    }
  })();
}
window.shareFolderModal = shareFolderModal;

/* ===================== toast ===================== */
function toast(msg) {
  const t = el(`<div class="toast">${icon("check", { size: 15, cls: "ok-ic" })} ${esc(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 250);
  }, 2600);
}
window.toast = toast;

/* ===================== upload ===================== */
function pickUpload() {
  const inp = el(`<input type="file" multiple hidden />`);
  document.body.appendChild(inp);
  inp.onchange = () => {
    if (inp.files.length) startUploads([...inp.files]);
    inp.remove();
  };
  inp.click();
}
window.pickUpload = pickUpload;

function uploadModal() {
  const modal = el(`<div class="modal-bg"><div class="modal card-modal">
    <div class="head"><div class="t">${icon("uploadCloud", { size: 16 })} Uploading</div><button class="icon-btn" id="closeUp">${icon("x", { size: 18 })}</button></div>
    <div class="body"><div class="uploads" id="upList"></div></div>
  </div></div>`);
  document.body.appendChild(modal);
  modal.querySelector("#closeUp").onclick = () => modal.remove();
  return modal;
}

async function startUploads(files) {
  const modal = uploadModal();
  const list = modal.querySelector("#upList");
  for (const file of files) {
    const item = el(`<div class="up-item"><div class="up-top"><div class="up-nm">${fileIcon(kindOf(file.type, file.name), 18)}<span>${esc(file.name)}</span></div><div class="up-sz">${fmtSize(file.size)}</div></div><div class="up-ph">Queued…</div><div class="bar"><div></div></div></div>`);
    list.appendChild(item);
    try {
      await uploadOne(file, item);
    } catch (err) {
      item.classList.add("err");
      item.querySelector(".up-ph").textContent = "Failed: " + err.message;
    }
  }
  await loadFiles(true);
  toast("Upload complete");
}
window.startUploads = startUploads;
function kindOf(mime, name) {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || name?.endsWith(".pdf")) return "pdf";
  return "file";
}

function uploadOne(file, item) {
  return new Promise((resolve, reject) => {
    const job = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)) + Date.now();
    const bar = item.querySelector(".bar > div");
    const ph = item.querySelector(".up-ph");
    const es = new EventSource(`/api/files/upload/progress?job=${job}`);
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.error) {
          es.close();
          reject(new Error(d.error));
          return;
        }
        const pct = Math.round((d.ratio || 0) * 100);
        if (d.phase === "receiving") {
          bar.style.width = pct + "%";
          ph.textContent = `Uploading to server… ${pct}%`;
        } else if (d.phase === "sending") {
          bar.style.width = pct + "%";
          ph.textContent = `Sending to Telegram… ${pct}%`;
        }
        if (d.done) {
          es.close();
          item.classList.add("ok");
          bar.style.width = "100%";
          ph.textContent = "Done";
          resolve();
        }
      } catch {}
    };
    es.onerror = () => {};
    fetch(`/api/files/upload?folder=${state.currentFolder}`, {
      method: "POST",
      credentials: "include",
      headers: { "X-Job": job, "X-Filename": encodeURIComponent(file.name), "X-Filesize": file.size, "X-Force-Document": "1" },
      body: file,
    })
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          es.close();
          reject(new Error(j.error || "Upload failed"));
        }
      })
      .catch((err) => {
        es.close();
        reject(err);
      });
  });
}

/* drag & drop */
document.addEventListener("dragover", (e) => {
  if (state.currentFolder && e.dataTransfer?.types?.includes("Files")) {
    e.preventDefault();
    $("#layout")?.classList.add("dropping");
  }
});
document.addEventListener("dragleave", () => $("#layout")?.classList.remove("dropping"));
document.addEventListener("drop", (e) => {
  $("#layout")?.classList.remove("dropping");
  if (!state.currentFolder || !e.dataTransfer?.files?.length) return;
  e.preventDefault();
  startUploads([...e.dataTransfer.files]);
});

/* ===================== folders ===================== */
async function newFolder() {
  const title = prompt("New folder name (creates a Telegram channel):", "My folder");
  if (!title) return;
  try {
    await api("/api/folders", { method: "POST", body: JSON.stringify({ title }) });
    await loadFolders();
    toast("Folder created");
  } catch (err) {
    alert(err.message);
  }
}
window.newFolder = newFolder;

/* ===================== accounts ===================== */
async function addAccount() {
  if (!state.user?.isAdmin) return toast("Only admins can connect accounts");
  state.currentFolder = null;
  state.accounts = [];
  renderConnect();
}
window.addAccount = addAccount;
async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  location.reload();
}
window.logout = logout;

/* ===================== views: shares / keys / settings ===================== */
async function openView(v) {
  state.currentFolder = null;
  state.currentView = v;
  toggleSidebar(false);
  renderSidebar();
  $("#topActions").innerHTML = v === "keys" ? `<button class="primary" onclick="newKey()">${icon("plus", { size: 15 })} New key</button>` : v === "users" ? `<button class="primary" onclick="newUser()">${icon("userPlus", { size: 15 })} Add user</button>` : "";
  if (v === "shares") return viewShares();
  if (v === "keys") return viewKeys();
  if (v === "users") return viewUsers();
  if (v === "settings") return viewSettings();
}

async function viewShares() {
  $("#title").innerHTML = `${icon("share", { size: 18 })} Share links`;
  content().innerHTML = `<div class="center-load"><div class="spinner"></div></div>`;
  try {
    const r = await api("/api/shares");
    const items = r.shares
      .map(
        (s) => `<div class="kv-row">
        <div class="kv-ic">${s.needsPassword ? icon("lock", { size: 16 }) : icon(s.kind === "folder" ? "folder" : "file", { size: 16 })}</div>
        <div class="info"><div class="t">${esc(s.name || "file")} ${s.kind === "folder" ? '<span class="tag">folder</span>' : ""} ${s.expired ? '<span class="tag bad">expired</span>' : ""}</div>
          <div class="s">${fmtSize(s.size)} ${s.needsPassword ? "· protected" : ""} · ${s.downloads} dl${s.expiresAt ? " · exp " + new Date(s.expiresAt).toLocaleDateString() : ""}</div>
          <div class="s mono">${esc(s.url)}</div></div>
        <button class="icon-btn" title="Copy" onclick="copyTxt('${esc(s.url)}')">${icon("copy", { size: 16 })}</button>
        <button class="icon-btn danger" title="Delete" onclick="delShare('${s.id}')">${icon("trash", { size: 16 })}</button>
      </div>`
      )
      .join("");
    content().innerHTML = items ? `<div class="kv-list">${items}</div>` : emptyHtml("No share links yet", "share");
  } catch (err) {
    content().innerHTML = emptyHtml(err.message, "alert");
  }
}
window.copyTxt = async (t) => {
  const ok = await copyText(t);
  toast(ok ? "Copied" : "Press Ctrl+C to copy");
};
window.delShare = async (id) => {
  if (!confirm("Delete this share link?")) return;
  await api("/api/shares/" + id, { method: "DELETE" });
  viewShares();
};

async function viewKeys() {
  $("#title").innerHTML = `${icon("key", { size: 18 })} API keys`;
  content().innerHTML = `<div class="center-load"><div class="spinner"></div></div>`;
  try {
    const r = await api("/api/keys");
    const items = r.keys
      .map((k) => `<div class="kv-row">
        <div class="kv-ic">${icon("key", { size: 16 })}</div>
        <div class="info"><div class="t">${esc(k.label)}</div><div class="s">${esc(state.accounts.find((a) => a.id === k.account_id)?.label || k.account_id)} · ${new Date(k.created_at).toLocaleDateString()}</div></div>
        <button class="icon-btn danger" title="Revoke" onclick="delKey('${k.id}')">${icon("trash", { size: 16 })}</button>
      </div>`)
      .join("");
    content().innerHTML = items ? `<div class="kv-list">${items}</div>` : emptyHtml("No API keys. Create one to use the REST API.", "key", `<button class="primary" onclick="newKey()">${icon("plus", { size: 15 })} New key</button>`);
  } catch (err) {
    content().innerHTML = emptyHtml(err.message, "alert");
  }
}
window.newKey = async () => {
  const acc = state.currentAccountId;
  if (!acc) return toast("Select an account first");
  const label = prompt("Label for this key:", "My app");
  if (!label) return;
  const r = await api("/api/keys", { method: "POST", body: JSON.stringify({ label, account: acc }) });
  const ok = await copyText(r.key);
  alert("API key created (shown once):\n\n" + r.key + (ok ? "\n\nCopied to clipboard." : "\n\nCopy it now — it won't be shown again."));
  viewKeys();
};
window.delKey = async (id) => {
  if (!confirm("Revoke this API key?")) return;
  await api("/api/keys/" + id, { method: "DELETE" });
  viewKeys();
};

function viewSettings() {
  $("#title").innerHTML = `${icon("settings", { size: 18 })} Settings`;
  const isAdmin = !!state.user?.isAdmin;
  const accs = state.accounts.map((a) => `<div class="kv-row">
      <div class="kv-ic">${a.premium ? icon("zap", { size: 16, cls: "gold" }) : icon("user", { size: 16 })}</div>
      <div class="info"><div class="t">${esc(a.label)} ${a.id === state.currentAccountId ? '<span class="tag">active</span>' : ""}</div><div class="s">${esc(a.phone || a.username || "")}</div></div>
      ${a.id !== state.currentAccountId ? `<button class="btn-2" onclick="switchAcc('${a.id}')">Switch</button>` : ""}
      ${isAdmin ? `<button class="icon-btn danger" title="Remove" onclick="delAcc('${a.id}')">${icon("trash", { size: 16 })}</button>` : ""}
    </div>`);
  const brandLogoPreview = brand.logo
    ? `<img class="brand-logo-img" src="${esc(brand.logo)}" alt="" width="40" height="40" />`
    : `<span class="brand-logo-ph">${brandMark(28)}</span>`;
  const brandCard = isAdmin ? `
      <div class="set-card" style="grid-column:1/-1">
        <div class="set-head">${icon("cloud", { size: 16 })} Branding</div>
        <div class="brand-form">
          <div class="field brand-logo-row">
            <label>Logo</label>
            <div class="brand-logo-pick">
              <div class="brand-logo-box" id="brandLogoBox">${brandLogoPreview}</div>
              <div class="brand-logo-btns">
                <label class="btn-2">${icon("upload", { size: 14 })} Upload<input type="file" id="logoFile" accept="image/*" hidden /></label>
                ${brand.logo ? `<button class="btn-2 danger" id="logoRemove">${icon("trash", { size: 14 })} Remove</button>` : ""}
                <span class="hint" id="logoMsg">PNG / SVG / WebP, up to 2 MB.</span>
              </div>
            </div>
          </div>
          <div class="field"><label>App name</label><input id="brName" value="${esc(brand.name)}" maxlength="40" placeholder="Telegram Drive" /></div>
          <div class="field"><label>Accent color</label>
            <div class="brand-color-row">
              <input type="color" id="brAccentColor" value="${esc(brand.accent)}" />
              <input type="text" id="brAccentHex" value="${esc(brand.accent)}" maxlength="7" placeholder="#4f8cff" />
              <div class="brand-swatches">
                ${["#4f8cff", "#22c55e", "#f43f5e", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#10b981"].map((c) => `<button type="button" class="swatch" data-c="${c}" style="background:${c}" title="${c}"></button>`).join("")}
              </div>
            </div>
          </div>
          <div class="field"><label>Share tagline</label><input id="brTagline" value="${esc(brand.tagline)}" maxlength="80" placeholder="Secure file sharing" /></div>
          <div class="field"><label>Copyright line <span class="hint">(leave blank to auto-use “© year · name”)</span></label><input id="brCopy" value="${esc(brand.copyright)}" maxlength="80" placeholder="© ${new Date().getFullYear()} My Drive" /></div>
          <div class="brand-actions"><button class="primary" id="brSave">${icon("check", { size: 15 })} Save branding</button><div class="err" id="brErr"></div></div>
          <p class="hint brand-credit-note">The credit “Telegram Web Drive Made with ♥ by Samer Ahmed” is always shown on public pages and cannot be removed.</p>
        </div>
      </div>` : "";
  content().innerHTML = `
    <div class="settings-grid">
      ${brandCard}
      <div class="set-card">
        <div class="set-head">${icon("user", { size: 16 })} Profile</div>
        <div class="kv-list"><div class="kv-row"><div class="kv-ic">${icon(state.user?.isAdmin ? "shield" : "user", { size: 16 })}</div>
          <div class="info"><div class="t">${esc(state.user?.username || "")} <span class="tag">${state.user?.isAdmin ? "admin" : "user"}</span></div></div></div></div>
        <form id="pwForm" style="margin-top:12px">
          <div class="field"><label>Change password</label>
            <div class="input-wrap">${icon("lock", { size: 16, cls: "lead" })}<input type="password" id="curPw" placeholder="Current password" required /></div></div>
          <div class="row">
            <div class="input-wrap">${icon("lock", { size: 16, cls: "lead" })}<input type="password" id="newPw" placeholder="New password" required minlength="4" /></div>
            <button class="primary" type="submit">${icon("check", { size: 15 })} Update</button>
          </div>
          <div class="err" id="pwErr"></div>
        </form>
      </div>
      <div class="set-card">
        <div class="set-head">${icon("sun", { size: 16 })} Appearance</div>
        <div class="theme-row big">
          <button class="seg ${theme.current === "dark" ? "on" : ""}" onclick="setTheme('dark')">${icon("moon", { size: 16 })} Dark</button>
          <button class="seg ${theme.current === "light" ? "on" : ""}" onclick="setTheme('light')">${icon("sun", { size: 16 })} Light</button>
        </div>
      </div>
      <div class="set-card" style="grid-column:1/-1">
        <div class="set-head">${icon("user", { size: 16 })} Telegram accounts</div>
        <div class="kv-list">${accs.join("")}</div>
        ${isAdmin ? `<button class="btn-2" style="margin-top:10px" onclick="addAccount()">${icon("userPlus", { size: 15 })} Connect another</button>` : `<p class="hint">Only admins can add or remove accounts.</p>`}
      </div>
    </div>`;
  $("#pwForm").onsubmit = async (e) => {
    e.preventDefault();
    $("#pwErr").textContent = "";
    try {
      await api("/api/auth/password", { method: "POST", body: JSON.stringify({ current: $("#curPw").value, next: $("#newPw").value }) });
      $("#curPw").value = $("#newPw").value = "";
      toast("Password updated");
    } catch (err) {
      $("#pwErr").textContent = err.message;
    }
  };
  wireBranding();
}
function isValidHex(v) { return /^#[0-9a-fA-F]{6}$/.test(String(v || "").trim()); }
function wireBranding() {
  const save = $("#brSave");
  if (!save) return;
  const color = $("#brAccentColor"), hex = $("#brAccentHex");
  color.oninput = () => (hex.value = color.value);
  hex.oninput = () => { if (isValidHex(hex.value)) color.value = hex.value; };
  $$(".brand-swatches .swatch").forEach((s) => (s.onclick = () => { hex.value = color.value = s.dataset.c; }));
  $("#brSave").onclick = async () => {
    const err = $("#brErr");
    err.textContent = "";
    if (!isValidHex(hex.value)) return (err.textContent = "Accent must be a #rrggbb hex color.");
    const body = { name: $("#brName").value.trim() || "Telegram Drive", accent: hex.value.trim(), tagline: $("#brTagline").value, copyright: $("#brCopy").value };
    save.disabled = true;
    try {
      const r = await api("/api/branding", { method: "PUT", body: JSON.stringify(body) });
      brand = { ...brand, ...r.branding };
      applyBranding();
      renderSidebar();
      toast("Branding saved");
    } catch (e) {
      err.textContent = e.message;
    } finally {
      save.disabled = false;
    }
  };
  const fileInput = $("#logoFile");
  if (fileInput) {
    fileInput.onchange = async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      const msg = $("#logoMsg");
      if (f.size > 2 * 1024 * 1024) return (msg.textContent = "Too large (max 2 MB).");
      msg.textContent = "Uploading…";
      try {
        const buf = await f.arrayBuffer();
        const r = await api("/api/branding/logo", { method: "POST", headers: { "Content-Type": f.type }, body: buf });
        brand.logo = r.logo;
        $("#brandLogoBox").innerHTML = `<img class="brand-logo-img" src="${esc(brand.logo)}" alt="" width="40" height="40" />`;
        msg.textContent = "Logo updated.";
        viewSettings();
      } catch (e) {
        msg.textContent = e.message;
      }
    };
  }
  const rm = $("#logoRemove");
  if (rm) {
    rm.onclick = async () => {
      if (!confirm("Remove the brand logo?")) return;
      try {
        await api("/api/branding/logo", { method: "DELETE" });
        brand.logo = "";
        viewSettings();
      } catch (e) {
        toast(e.message);
      }
    };
  }
}
window.switchAcc = async (id) => {
  await api("/api/accounts/switch/" + id, { method: "POST" });
  state.currentAccountId = id;
  state.currentFolder = null;
  state.auth.currentAccountId = id;
  state.folders = [];
  renderApp();
  await loadFolders();
};
window.delAcc = async (id) => {
  if (!state.user?.isAdmin) return toast("Admin only");
  if (!confirm("Remove this account and its folders? Files stay in your Telegram.")) return;
  await api("/api/accounts/" + id, { method: "DELETE" });
  state.auth = await api("/api/auth/state");
  state.accounts = state.auth.accounts;
  if (!state.accounts.length) return location.reload();
  if (state.currentAccountId === id) return switchAcc(state.accounts[0].id);
  viewSettings();
};

/* ===================== users (admin) ===================== */
async function viewUsers() {
  $("#title").innerHTML = `${icon("users", { size: 18 })} Users`;
  content().innerHTML = `<div class="center-load"><div class="spinner"></div></div>`;
  try {
    const r = await api("/api/users");
    const items = r.users
      .map((u) => `<div class="kv-row">
        <div class="kv-ic">${u.role === "admin" ? icon("shield", { size: 16 }) : icon("user", { size: 16 })}</div>
        <div class="info"><div class="t">${esc(u.username)} <span class="tag">${u.role}</span>${u.id === r.currentUserId ? ' <span class="tag">you</span>' : ""}</div><div class="s">Created ${new Date(u.created_at).toLocaleDateString()}</div></div>
        <button class="btn-2" onclick="resetUserPw('${u.id}','${esc(u.username)}')">${icon("lock", { size: 14 })} Password</button>
        <button class="btn-2" onclick="toggleUserRole('${u.id}','${u.role}')">${u.role === "admin" ? "Make user" : "Make admin"}</button>
        ${u.id !== r.currentUserId ? `<button class="icon-btn danger" title="Delete" onclick="delUser('${u.id}','${esc(u.username)}')">${icon("trash", { size: 16 })}</button>` : ""}
      </div>`)
      .join("");
    content().innerHTML = items ? `<div class="kv-list">${items}</div>` : emptyHtml("No users", "users");
  } catch (err) {
    content().innerHTML = emptyHtml(err.message, "alert");
  }
}
window.newUser = async () => {
  const username = prompt("New username:");
  if (!username) return;
  const password = prompt("Password for " + username + ":");
  if (!password) return;
  const role = confirm("Make this user an ADMIN? (Cancel = regular user)") ? "admin" : "user";
  try {
    await api("/api/users", { method: "POST", body: JSON.stringify({ username, password, role }) });
    toast("User created");
    viewUsers();
  } catch (err) {
    alert(err.message);
  }
};
window.resetUserPw = async (id, name) => {
  const password = prompt("New password for " + name + ":");
  if (!password) return;
  try {
    await api("/api/users/" + id, { method: "PATCH", body: JSON.stringify({ password }) });
    toast("Password updated");
  } catch (err) {
    alert(err.message);
  }
};
window.toggleUserRole = async (id, role) => {
  const next = role === "admin" ? "user" : "admin";
  try {
    await api("/api/users/" + id, { method: "PATCH", body: JSON.stringify({ role: next }) });
    viewUsers();
  } catch (err) {
    alert(err.message);
  }
};
window.delUser = async (id, name) => {
  if (!confirm("Delete user " + name + "?")) return;
  try {
    await api("/api/users/" + id, { method: "DELETE" });
    viewUsers();
  } catch (err) {
    alert(err.message);
  }
};

/* ===================== public share ===================== */
async function renderPublicShare(id) {
  $("#app").innerHTML = `<div class="center-load"><div class="spinner"></div></div>`;
  let s;
  try {
    s = await api(`/api/public/share/${id}`);
  } catch (err) {
    return renderError(err.data?.error || err.message || "Share not available.");
  }
  if (s.expired) return renderError("This share link has expired.");
  document.title = s.name || "Shared";

  const tParam = (tok) => (tok ? `?token=${encodeURIComponent(tok)}` : "");
  const shell = (inner) =>
    `<div class="pub-wrap">
      <header class="pub-head"><div class="pub-brand">${brandMark(22)}<span>${brandName()}</span></div></header>
      <main class="pub-main">${inner}</main>
      <footer class="pub-foot"><span class="pub-tagline">${esc(brand.tagline || "")}</span><span class="pub-copy">${esc(brandFootCopyright())}</span><span class="pub-credit">${CREDIT_HTML}</span></footer>
    </div>`;

  function showGate() {
    $("#app").innerHTML = shell(`<div class="pub-card">
      <div class="pub-lock">${icon("lock", { size: 30 })}</div>
      <h2>${esc(s.kind === "folder" ? "Shared folder" : "Shared file")}</h2>
      <p class="muted">This link is password protected.</p>
      <form id="pwForm" class="pub-form">
        <div class="input-wrap">${icon("lock", { size: 16, cls: "lead" })}<input type="password" id="spw" required autofocus placeholder="Password" /></div>
        <button class="primary block" type="submit">${icon("shield", { size: 15 })} Unlock</button>
        <div class="err" id="err"></div>
      </form>
    </div>`);
    $("#pwForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api(`/api/public/share/${id}/access`, { method: "POST", body: JSON.stringify({ password: $("#spw").value }) });
        renderContent(r.token);
      } catch (err) {
        $("#err").textContent = err.message;
      }
    };
  }

  async function renderContent(token) {
    if (s.kind === "folder") return renderFolder(token);
    return renderFile(token);
  }

  const withDl = (url) => url + (url.includes("?") ? "&" : "?") + "dl=1";

  function renderFile(token) {
    const raw = `/s/${id}/raw${tParam(token)}`;
    const thumb = `/s/${id}/thumb${tParam(token)}`;
    const kind = kindOf(s.mime, s.name);
    let preview = "";
    if (kind === "image")
      preview = `<div class="pub-preview img"><img src="${raw}" alt="${esc(s.name)}" onerror="this.closest('.pub-preview').classList.add('broken')" /></div>`;
    else if (kind === "video")
      preview = `<div class="pub-preview video"><video src="${raw}" controls playsinline preload="metadata" poster="${thumb}"></video><span class="pub-vbadge">${icon("film", { size: 13 })} Video</span></div>`;
    else if (kind === "audio")
      preview = `<div class="pub-preview audio">${fileIcon("audio", 44)}<audio src="${raw}" controls preload="metadata"></audio></div>`;
    else if (kind === "pdf") preview = `<iframe class="pub-pdf" src="${raw}"></iframe>`;
    else preview = `<div class="pub-preview icon">${fileIcon(kind, 70)}<div class="pub-noaudio">No preview available</div></div>`;
    $("#app").innerHTML = shell(`<div class="pub-card file">
      ${preview}
      <div class="pub-info">
        <div class="pub-meta">${fileIcon(kind, 22)}<div class="pub-metain"><div class="pub-name" title="${esc(s.name)}">${esc(s.name)}</div><div class="pub-stats">${fmtSize(s.size)}${s.downloads ? ` · ${s.downloads} download${s.downloads === 1 ? "" : "s"}` : ""}${s.expiresAt ? ` · expires ${new Date(s.expiresAt).toLocaleDateString()}` : ""}</div></div></div>
        <a class="pub-btn primary" href="${withDl(raw)}" download>${icon("download", { size: 18 })}<span>Download</span></a>
      </div>
    </div>`);
  }

  async function renderFolder(token) {
    const zipUrl = `/s/${id}/zip${tParam(token)}`;
    $("#app").innerHTML = shell(`<div class="pub-card wide">
      <div class="pub-folder-head">${icon("folder", { size: 30 })}<div class="pub-fh-info"><div class="pub-name">${esc(s.name)}</div><div class="pub-stats" id="fcount">Loading files…</div></div><a class="pub-btn sm" id="dlAllBtn" href="${zipUrl}" download>${icon("download", { size: 15 })}<span>Download all</span></a></div>
      <div class="pub-grid" id="fgrid"><div class="center-load" style="min-height:140px"><div class="spinner"></div></div></div>
    </div>`);
    let items = [];
    try {
      const r = await api(`/api/public/share/${id}/files${tParam(token)}`);
      items = r.items || [];
    } catch (err) {
      $("#fgrid").innerHTML = `<p class="muted">${esc(err.message)}</p>`;
      return;
    }
    $("#fcount").textContent = `${items.length} file${items.length === 1 ? "" : "s"} · ${fmtSize(items.reduce((n, f) => n + (f.size || 0), 0))} total`;
    if (!items.length) {
      $("#fgrid").innerHTML = `<div class="pub-empty">${icon("folder", { size: 40 })}<p>This folder is empty.</p></div>`;
      return;
    }
    $("#fgrid").innerHTML = items
      .map((f) => {
        const kind = f.kind;
        const showImg = kind === "image" || kind === "video";
        const thumb = `${fileIcon(kind, 38)}${showImg ? `<img class="thumb-img" loading="lazy" src="${f.thumbUrl}" onload="this.parentNode.classList.add('has-img')" onerror="this.remove()" alt="" />` : ""}`;
        return `<a class="pub-item" href="${withDl(f.rawUrl)}" target="_blank" rel="noopener">
          <div class="thumb">${thumb}${kind === "video" ? `<span class="play-badge">${icon("play", { size: 11 })}</span>` : ""}</div>
          <div class="pub-iname" title="${esc(f.caption || f.name)}">${esc(f.caption || f.name)}</div>
          <div class="pub-isize">${fmtSize(f.size)}</div>
        </a>`;
      })
      .join("");
  }

  if (s.needsPassword) showGate();
  else renderContent("");
}

boot();
