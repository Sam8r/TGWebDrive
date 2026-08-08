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
  renderBrand();
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
/* ===================== modal & menu primitives (no native dialogs) ===================== */
function modalOverlay(inner, { closeOnBg = true } = {}) {
  const bg = el(`<div class="modal-bg"></div>`);
  bg.appendChild(inner);
  document.body.appendChild(bg);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    bg.remove();
  };
  if (closeOnBg) bg.onclick = (e) => { if (e.target === bg) close(); };
  bg._close = close;
  bg._inner = inner;
  return bg;
}
function uiAlert(message, { title = "", okText = "OK", icon: ic } = {}) {
  return new Promise((resolve) => {
    const card = el(`<div class="modal card-modal gd-dialog">
      <div class="gd-dialog-body">${ic ? `<div class="gd-dlg-ic">${ic}</div>` : ""}${title ? `<div class="gd-dlg-title">${esc(title)}</div>` : ""}${message ? `<div class="gd-dlg-msg">${esc(message)}</div>` : ""}</div>
      <div class="gd-dialog-actions"><button class="primary" id="gdOk">${esc(okText)}</button></div>
    </div>`);
    const bg = modalOverlay(card);
    card.querySelector("#gdOk").onclick = () => { bg._close(); resolve(true); };
    document.addEventListener(
      "keydown",
      function h(e) {
        if (e.key === "Escape" || e.key === "Enter") {
          bg._close();
          document.removeEventListener("keydown", h);
          resolve(true);
        }
      }
    );
  });
}
function uiConfirm(message, { title = "Please confirm", okText = "Confirm", cancelText = "Cancel", danger = false, icon: ic } = {}) {
  return new Promise((resolve) => {
    const card = el(`<div class="modal card-modal gd-dialog">
      <div class="gd-dialog-body">${ic ? `<div class="gd-dlg-ic ${danger ? "err-ic" : ""}">${ic}</div>` : ""}<div class="gd-dlg-title">${esc(title)}</div>${message ? `<div class="gd-dlg-msg">${message}</div>` : ""}</div>
      <div class="gd-dialog-actions"><button class="btn-2" id="gdNo">${esc(cancelText)}</button><button class="${danger ? "btn-2 danger-solid" : "primary"}" id="gdYes">${esc(okText)}</button></div>
    </div>`);
    const bg = modalOverlay(card);
    let val = false;
    const done = () => { bg._close(); resolve(val); };
    card.querySelector("#gdNo").onclick = done;
    card.querySelector("#gdYes").onclick = () => { val = true; done(); };
    document.addEventListener(
      "keydown",
      function h(e) {
        if (e.key === "Escape") { document.removeEventListener("keydown", h); done(); }
        if (e.key === "Enter") { val = true; document.removeEventListener("keydown", h); done(); }
      }
    );
  });
}
function uiPrompt({ label = "", placeholder = "", value = "", title = "", okText = "OK", multiline = false, validate } = {}) {
  return new Promise((resolve) => {
    const field = multiline
      ? `<textarea id="pIn" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input id="pIn" placeholder="${esc(placeholder)}" value="${esc(value)}" />`;
    const card = el(`<div class="modal card-modal gd-dialog">
      <div class="gd-dialog-body">${title ? `<div class="gd-dlg-title">${esc(title)}</div>` : ""}${label ? `<div class="gd-dlg-msg">${esc(label)}</div>` : ""}<div class="gd-dlg-field">${field}</div><div class="err" id="pErr"></div></div>
      <div class="gd-dialog-actions"><button class="btn-2" id="gdNo">Cancel</button><button class="primary" id="gdYes">${esc(okText)}</button></div>
    </div>`);
    const bg = modalOverlay(card);
    const input = card.querySelector("#pIn");
    const errEl = card.querySelector("#pErr");
    setTimeout(() => { input.focus(); input.select && input.select(); }, 30);
    const submit = () => {
      const v = input.value;
      if (validate) {
        const e = validate(v);
        if (e) return (errEl.textContent = e);
      }
      bg._close();
      resolve(v);
    };
    const cancel = () => { bg._close(); resolve(null); };
    card.querySelector("#gdYes").onclick = submit;
    card.querySelector("#gdNo").onclick = cancel;
    input.onkeydown = (e) => {
      if (e.key === "Enter" && !multiline) submit();
      if (e.key === "Escape") cancel();
    };
  });
}
let __menu = null;
function closeMenus() {
  if (__menu) {
    __menu.remove();
    __menu = null;
    document.removeEventListener("mousedown", onMenuAway, true);
  }
}
function onMenuAway(e) {
  if (__menu && !__menu.contains(e.target) && !e.target.closest(".gd-menu-anchor")) closeMenus();
}
function openMenu(anchor, items, { align = "left", header } = {}) {
  closeMenus();
  const m = el(`<div class="gd-menu"></div>`);
  if (header) m.appendChild(el(`<div class="gd-menu-head">${header}</div>`));
  items.forEach((it) => {
    if (it.divider) {
      m.appendChild(el(`<div class="gd-menu-div"></div>`));
      return;
    }
    const b = el(`<button class="gd-menu-item${it.danger ? " danger" : ""}">${it.icon ? `<span class="gd-menu-ic">${it.icon}</span>` : ""}<span class="gd-menu-tx">${esc(it.label)}</span></button>`);
    b.onclick = () => {
      closeMenus();
      it.onClick && it.onClick();
    };
    if (it.disabled) b.disabled = true;
    m.appendChild(b);
  });
  m.style.visibility = "hidden";
  document.body.appendChild(m);
  __menu = m;
  anchor.classList.add("gd-menu-anchor");
  requestAnimationFrame(() => {
    const r = anchor.getBoundingClientRect();
    const mr = m.getBoundingClientRect();
    let left = align === "right" ? r.right - mr.width : r.left;
    let top = r.bottom + 6;
    if (left + mr.width > window.innerWidth - 8) left = window.innerWidth - mr.width - 8;
    if (left < 8) left = 8;
    if (top + mr.height > window.innerHeight - 8) top = Math.max(8, r.top - mr.height - 6);
    m.style.left = left + "px";
    m.style.top = top + "px";
    m.style.visibility = "visible";
  });
  setTimeout(() => document.addEventListener("mousedown", onMenuAway, true), 0);
  return m;
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
theme(localStorage.getItem("tg.theme") || "light");

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
    <label class="remember"><input type="checkbox" id="rmb" checked /><span>Remember me</span><small>Stay logged in for 90 days</small></label>
    <div class="err" id="err"></div>
    <button class="primary block" type="submit">${icon("logout", { size: 16, cls: "flip" })} Sign in</button>
  </form>`);
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: $("#un").value, password: $("#pw").value, remember: $("#rmb").checked }) });
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
function renderBrand() {
  const t = $("#topBrand");
  if (t) t.innerHTML = `${brandMark(20)}<span class="brand-name">${brandName()}</span>`;
}
function renderApp() {
  $("#app").innerHTML = `
  <div class="layout" id="layout">
    <div class="scrim" onclick="toggleSidebar(false)"></div>
    <aside class="sidebar">
      <div class="brand" id="topBrand"></div>
      <button class="gd-new" id="newBtn">${icon("plus", { size: 20 })}<span>New</span></button>
      <div class="nav" id="nav"></div>
      <div class="side-foot">${CREDIT_HTML}</div>
    </aside>
    <main class="main">
      <div class="topbar">
        <button class="icon-btn menu-btn" id="menuBtn" title="Menu">${icon("menu")}</button>
        <div class="searchbox">${icon("search", { size: 18, cls: "lead" })}<input class="search" id="search" placeholder="Search in drive…" /></div>
        <div class="spacer"></div>
        <button class="icon-btn" id="themeBtn" title="Toggle theme">${icon(theme.current === "dark" ? "sun" : "moon", { size: 19 })}</button>
        <button class="gd-avatar" id="avatarBtn" title="${esc(state.user?.username || "")}">${esc((state.user?.username || "?").charAt(0).toUpperCase())}</button>
      </div>
      <div class="subbar"><div class="title" id="title">—</div><div class="actions" id="topActions"></div></div>
      <div class="content" id="content"></div>
    </main>
  </div>`;
  renderBrand();
  $("#menuBtn").onclick = () => toggleSidebar(!state.sidebarOpen);
  $("#search").oninput = (e) => {
    state.search = e.target.value.trim();
    clearTimeout(window.__st);
    window.__st = setTimeout(() => loadFiles(true), 350);
  };
  $("#themeBtn").onclick = () => setTheme(theme.current === "dark" ? "light" : "dark");
  $("#avatarBtn").onclick = (e) => openAvatarMenu(e.currentTarget);
  $("#newBtn").onclick = (e) => openNewMenu(e.currentTarget);
  mountUploader();
  renderSidebar();
}
function openNewMenu(anchor) {
  const inFolder = !!state.currentFolder;
  openMenu(anchor, [
    { icon: icon("folderPlus", { size: 18 }), label: state.currentFolder ? "New subfolder" : "New folder", onClick: () => newFolder(state.currentFolder) },
    { divider: true },
    { icon: icon("uploadCloud", { size: 18 }), label: "Upload files", onClick: () => (inFolder ? pickUpload() : toast("Open a folder first")) },
    { icon: icon("hardDriveDownload", { size: 18 }), label: "Upload folder", onClick: () => (inFolder ? pickUploadFolder() : toast("Open a folder first")) },
  ]);
}
function openAvatarMenu(anchor) {
  openMenu(
    anchor,
    [
      { icon: icon("settings", { size: 18 }), label: "Settings", onClick: () => openView("settings") },
      { icon: icon("logout", { size: 18 }), label: "Log out", danger: true, onClick: logout },
    ],
    { align: "right", header: `<div class="gd-menu-user">${esc(state.user?.username || "")}</div><div class="gd-menu-role">${state.user?.isAdmin ? "admin" : "user"}</div>` }
  );
}
window.toggleSidebar = (v) => {
  state.sidebarOpen = v;
  $("#layout")?.classList.toggle("open", v);
};

function renderSidebar() {
  const nav = $("#nav");
  if (!nav) return;
  const folders = state.folders
    .filter((f) => !f.parentId)
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
    <div class="sec">My Folders</div>
    ${folders || `<div class="nav-muted">No folders yet</div>`}
    <div class="sec">Library</div>
    ${libItem("shares", "Share links", "share")}
    ${isAdmin ? libItem("keys", "API keys", "key") : ""}
    ${isAdmin ? libItem("users", "Users", "users") : ""}
    ${libItem("settings", "Settings", "settings")}`;
  $$(".nav-item[data-folder]", nav).forEach((n) => (n.onclick = () => openFolder(n.dataset.folder)));
  $$(".nav-item[data-view]", nav).forEach((n) => (n.onclick = () => openView(n.dataset.view)));
}
theme.current = localStorage.getItem("tg.theme") || "light";
window.setTheme = (t) => {
  theme.current = t;
  theme(t);
  const b = $("#themeBtn");
  if (b) b.innerHTML = icon(theme.current === "dark" ? "sun" : "moon", { size: 19 });
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
  // breadcrumb
  const chain = folderChain(id);
  $("#title").innerHTML =
    chain
      .map((c, idx) => {
        const last = idx === chain.length - 1;
        const ic = last ? icon(c.kind === "saved" ? "inbox" : "folder", { size: 18 }) : "";
        const lbl = last ? `<span class="cur">${esc(c.title)}</span>` : `<span class="crumb" onclick="openFolder('${c.id}')">${esc(c.title)}</span>`;
        return ic + lbl;
      })
      .join(`<span class="crumb-sep">${icon("chevronRight", { size: 13 })}</span>`) || `${icon("folder", { size: 18 })} Drive`;
  $("#topActions").innerHTML = `
    <button class="icon-btn" id="shareFolderBtn" title="Share whole folder">${icon("share")}</button>
    <button class="icon-btn" id="viewToggle" title="Toggle view">${icon(state.view === "grid" ? "list" : "grid")}</button>`;
  $("#viewToggle").onclick = () => {
    state.view = state.view === "grid" ? "list" : "grid";
    localStorage.setItem("tg.view", state.view);
    $("#viewToggle").innerHTML = icon(state.view === "grid" ? "list" : "grid");
    renderFiles();
  };
  $("#shareFolderBtn").onclick = () => shareFolderModal(f);
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

function renderSubfolders() {
  renderFiles();
}
function folderCard(f) {
  return `<div class="card folder-card" data-folder="${f.id}" title="${esc(f.title)}">
    <div class="card-actions"><button class="ca-btn danger" title="Delete folder" onclick="event.stopPropagation();deleteFolder('${f.id}')">${icon("trash", { size: 15 })}</button></div>
    <div class="fcard-ic">${icon(f.kind === "saved" ? "inbox" : "folder", { size: 40 })}</div>
    <div class="meta"><div class="nm" title="${esc(f.title)}">${esc(f.title)}</div><div class="sz">Folder</div></div>
  </div>`;
}
function wireFolderCards(scope) {
  $$(".folder-card", scope).forEach((n) => {
    n.onclick = () => openFolder(n.dataset.folder);
  });
}
function renderFiles() {
  const c = content();
  const subs = state.currentFolder ? state.folders.filter((f) => f.parentId === state.currentFolder) : [];
  const subsHtml = subs.length ? `<div class="subfolders">${subs.map(folderCard).join("")}</div>` : "";
  if (!state.files.length) {
    if (subs.length) {
      c.innerHTML = subsHtml;
      wireFolderCards(c);
      return;
    }
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
  const partBadge = (f) => (f.multipart ? `<span class="mp-badge" title="${f.partsCount} parts · reassembles on download">${icon("layers", { size: 11 })} ${f.partsCount}</span>` : "");
  const rowActions = (id) =>
    `<div class="row-actions"><button class="ca-btn" title="Download" onclick="event.stopPropagation();downloadFileById('${id}')">${icon("download", { size: 15 })}</button><button class="ca-btn" title="Share" onclick="event.stopPropagation();shareById('${id}')">${icon("share", { size: 15 })}</button><button class="ca-btn danger" title="Delete" onclick="event.stopPropagation();deleteFileById('${id}')">${icon("trash", { size: 15 })}</button></div>`;
  const list =
    state.view === "grid"
      ? `<div class="grid">${state.files.map(fileCard).join("")}</div>`
      : `<div class="list"><div class="list-head"><span>Name</span><span class="lh-right">Last modified · Size</span></div>${state.files
          .map(
            (f) => `<div class="row ${state.selected.has(selKey(f.id)) ? "selected" : ""}" data-id="${f.id}">
        <div class="row-ic">${fileIcon(f.kind, 20)}</div>
        <div class="row-main"><div class="row-nm">${esc(f.caption || f.name)}${partBadge(f)}</div><div class="row-sub">${fmtSize(f.size)} · ${fmtDate(f.date)}</div></div>
        <div class="row-ext">${esc(f.ext || "")}</div>
        ${rowActions(f.id)}
      </div>`
          )
          .join("")}</div>`;
  const more = state.offsetId ? `<div class="load-more"><button class="btn-2" onclick="loadFiles(false)">${icon("chevronRight", { size: 14, cls: "down" })} Load more</button></div>` : "";
  c.innerHTML = subsHtml + toolbar + list + more;
  wireFolderCards(c);
  $$(".card:not(.folder-card), .list .row", c).forEach((node) => {
    const id = node.dataset.id;
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
  const sel = state.selected.has(selKey(f.id)) ? "selected" : "";
  const showImg = f.kind === "image" || f.kind === "video";
  const thumb = `${fileIcon(f.kind, 40)}${showImg ? `<img class="thumb-img" loading="lazy" src="/api/files/${f.id}/thumb?folder=${state.currentFolder}" onload="this.parentNode.classList.add('has-img')" onerror="this.remove()" alt="" />` : ""}`;
  const badge = f.kind === "video" ? `<span class="play-badge">${icon("play", { size: 12 })}</span>` : "";
  const mpTag = f.multipart ? `<span class="mp-tag" title="${f.partsCount} parts · reassembles on download">${icon("layers", { size: 12 })} ${f.partsCount} parts</span>` : "";
  const actions = `<div class="card-actions"><button class="ca-btn" title="Download" onclick="event.stopPropagation();downloadFileById('${f.id}')">${icon("download", { size: 15 })}</button><button class="ca-btn" title="Share" onclick="event.stopPropagation();shareById('${f.id}')">${icon("share", { size: 15 })}</button><button class="ca-btn danger" title="Delete" onclick="event.stopPropagation();deleteFileById('${f.id}')">${icon("trash", { size: 15 })}</button></div>`;
  return `<div class="card ${sel}" data-id="${f.id}">
    <div class="card-sel">${icon("check", { size: 13 })}</div>
    ${actions}
    <div class="thumb">${thumb}${badge}</div>
    <div class="meta"><div class="nm" title="${esc(f.caption || f.name)}">${esc(f.caption || f.name)}</div><div class="sz">${fmtSize(f.size)} · ${fmtDate(f.date)}${mpTag}</div></div>
  </div>`;
}

function emptyHtml(msg, ic = "folder", action = "") {
  return `<div class="empty"><div class="empty-ic">${icon(ic, { size: 40 })}</div><div class="empty-msg">${msg}</div>${action}</div>`;
}

/* selection */
function selKey(id) {
  return String(id);
}
function toggleSelect(id) {
  const k = selKey(id);
  state.selected.has(k) ? state.selected.delete(k) : state.selected.add(k);
  renderFiles();
}
window.toggleSelect = toggleSelect;
window.clearSelection = () => {
  state.selected.clear();
  renderFiles();
};
window.toggleSelectAll = () => {
  if (state.files.length && state.selected.size === state.files.length) state.selected.clear();
  else state.files.forEach((f) => state.selected.add(selKey(f.id)));
  renderFiles();
};
const fileById = (id) => state.files.find((f) => String(f.id) === String(id));
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
  if (!(await uiConfirm(`“${f.name || "this file"}” will be permanently deleted from Telegram.`, { title: "Delete file?", okText: "Delete", danger: true, icon: icon("trash", { size: 20 }) }))) return;
  try {
    await api(`/api/files?folder=${state.currentFolder}`, { method: "DELETE", body: JSON.stringify({ ids: [f.id] }) });
    state.selected.delete(selKey(id));
    await loadFiles(true);
    toast("File deleted");
  } catch (err) {
    uiAlert(err.message, { title: "Delete failed" });
  }
};
window.downloadSelected = () => state.files.filter((f) => state.selected.has(selKey(f.id))).forEach(downloadFile);
window.deleteSelected = async () => {
  if (!(await uiConfirm(`${state.selected.size} file(s) will be permanently deleted from Telegram.`, { title: "Delete files?", okText: "Delete", danger: true, icon: icon("trash", { size: 20 }) }))) return;
  try {
    const ids = state.files.filter((f) => state.selected.has(selKey(f.id))).map((f) => f.id);
    await api(`/api/files?folder=${state.currentFolder}`, { method: "DELETE", body: JSON.stringify({ ids }) });
    state.selected.clear();
    await loadFiles(true);
  } catch (err) {
    uiAlert(err.message, { title: "Delete failed" });
  }
};
window.shareSelected = () => {
  const f = state.files.find((x) => state.selected.has(selKey(x.id)));
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
  const f = state.files.find((x) => String(x.id) === String(id));
  if (!f) return;
  const url = `/api/files/${f.id}/raw?folder=${state.currentFolder}`;
  let body = "";
  // Split files can't be seeked inline, so skip rich preview and offer download.
  if (f.multipart) body = "";
  else if (f.kind === "image") body = `<img src="${url}" alt="" />`;
  else if (f.kind === "video") body = `<video src="${url}" controls autoplay></video>`;
  else if (f.kind === "audio") body = `<div class="audio-wrap">${fileIcon("audio", 56)}<audio src="${url}" controls autoplay></audio></div>`;
  else if (f.kind === "pdf") body = `<iframe class="pdf" src="${url}"></iframe>`;
  if (!body)
    body = `<div class="no-prev">${fileIcon(f.multipart ? "archive" : f.kind, 56)}<div class="np-msg">${f.multipart ? `Split file · ${f.partsCount} parts` : "No preview available"}</div><div class="np-hint" style="color:var(--muted);font-size:12px;margin-bottom:12px">Downloads reassemble all parts into one file.</div><button class="primary" onclick="downloadFile(window.__pf)">${icon("download", { size: 16 })} Download</button></div>`;
  window.__pf = f;
  const capBtn = f.multipart
    ? `<button class="btn-2" onclick="renameModal(window.__pf)">${icon("pencil", { size: 15 })} Rename</button>`
    : `<button class="btn-2" onclick="renameModal(window.__pf)">${icon("pencil", { size: 15 })} Caption</button>`;
  const modal = el(`<div class="modal-bg" id="pmodal">
    <div class="modal wide">
      <div class="head"><div class="t">${fileIcon(f.kind, 18)} ${esc(f.caption || f.name)}</div>
        <button class="icon-btn" onclick="document.getElementById('pmodal').remove()">${icon("x", { size: 18 })}</button></div>
      <div class="preview-wrap">${body}</div>
      <div class="preview-info">
        <div class="pi-main"><div class="nm">${esc(f.name)}</div><div class="sz">${fmtSize(f.size)} · ${esc(f.ext || "")}</div></div>
        <div class="spacer"></div>
        ${capBtn}
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
  const isMp = !!f.multipart;
  const modal = el(`<div class="modal-bg"><form class="modal card-modal">
    <div class="head"><div class="t">${icon("pencil", { size: 16 })} ${isMp ? "Rename file" : "Edit caption"}</div><button type="button" class="icon-btn" onclick="this.closest('.modal-bg').remove()">${icon("x", { size: 18 })}</button></div>
    <div class="body">
      <div class="field"><label>${isMp ? "File name" : "Caption (the message text)"}</label>
        <div class="input-wrap">${icon("pencil", { size: 16, cls: "lead" })}<input id="cap" value="${esc(isMp ? f.name : f.caption || "")}" autofocus /></div></div>
      ${isMp ? `<p class="hint">This is a split file (${f.partsCount} parts). Renaming only affects how it is shown.</p>` : ""}
      <div class="err" id="err"></div>
      <div class="form-actions"><button type="button" class="btn-2 ghost" onclick="this.closest('.modal-bg').remove()">Cancel</button><button class="primary" type="submit">${icon("check", { size: 15 })} Save</button></div>
    </div></form></div>`);
  modal.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const val = modal.querySelector("#cap").value;
    try {
      const body = isMp ? { name: val } : { caption: val };
      await api(`/api/files/${f.id}?folder=${state.currentFolder}`, { method: "PATCH", body: JSON.stringify(body) });
      if (isMp) f.name = val;
      else f.caption = val;
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
      if (!(await uiConfirm("This share link will stop working immediately.", { title: "Delete share link?", okText: "Delete", danger: true, icon: icon("trash", { size: 20 }) }))) return;
      try {
        await api("/api/shares/" + meta.id, { method: "DELETE" });
        modal.remove();
        toast("Link deleted");
      } catch (err) {
        uiAlert(err.message, { title: "Failed" });
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
        const payload = { folder: state.currentFolder, name: f.name, mime: f.mime, size: f.size, password: pw, expiresInHours: exp };
        if (f.multipart) payload.multipartId = f.id;
        else payload.msgId = f.id;
        const r = await api("/api/shares", {
          method: "POST",
          body: JSON.stringify(payload),
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
      const idParam = f.multipart ? `multipartId=${encodeURIComponent(f.id)}` : `msgId=${f.id}`;
      const r = await api(`/api/shares/for?folder=${state.currentFolder}&${idParam}`);
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
      if (!(await uiConfirm("This folder share link will stop working immediately.", { title: "Delete folder share?", okText: "Delete", danger: true, icon: icon("trash", { size: 20 }) }))) return;
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

/* ===================== uploader (persistent, background) =====================
   A Google-Drive-style bottom dock. Uploads run in the background so navigating
   the app never interrupts them. Multiple files and whole folders are supported
   via drag-and-drop or the picker, and dropped folders recreate their structure
   as nested subfolders automatically. */
const up = { queue: [], active: 0, concurrency: 2, expanded: true, dock: null, ctrl: new Map() };
let upRenderQueued = false;
const subCache = new Map(); // "parentId|title" -> folderId (reuse subfolders)

function mountUploader() {
  if (up.dock && document.body.contains(up.dock)) return;
  up.dock = el(`<div id="upDock" class="up-dock" style="display:none"></div>`);
  up.dock.addEventListener("click", (e) => {
    const t = e.target.closest("[data-up-action]");
    if (!t) return;
    const a = t.dataset.upAction;
    if (a === "toggle") up.expanded = !up.expanded;
    else if (a === "clear") up.queue = up.queue.filter((i) => i.phase === "queued" || i.phase === "uploading");
    else if (a === "cancel") cancelUpload(t.dataset.id);
    else if (a === "cancel-all") cancelAllUploads();
    else if (a === "retry") retryUpload(t.dataset.id);
    renderUploader();
  });
  document.body.appendChild(up.dock);
}
function scheduleUpRender() {
  if (upRenderQueued) return;
  upRenderQueued = true;
  requestAnimationFrame(() => {
    upRenderQueued = false;
    renderUploader();
  });
}
function folderTitle(id) {
  return (state.folders.find((f) => f.id === id) || {}).title || "folder";
}
let upStructureKey = "";
// Structural fingerprint: anything that changes the DOM *shape* (an item added
// or removed, a phase/stage/part change, the collapse toggle). When it changes we
// rebuild the dock HTML; otherwise we only nudge widths/text in place — that keeps
// the spinners spinning and the bars gliding instead of restarting every tick.
function upKey() {
  return up.queue.map((i) => `${i.id}:${i.phase}:${i.stage || ""}:${i.part || ""}`).join("|") + `|e${up.expanded ? 1 : 0}`;
}
function renderUploader() {
  if (!up.dock) return;
  if (!up.queue.length) {
    up.dock.style.display = "none";
    up.dock.innerHTML = "";
    upStructureKey = "";
    return;
  }
  if (upKey() !== upStructureKey) {
    upStructureKey = upKey();
    buildUploader();
  }
  paintUploader();
}
function buildUploader() {
  const items = up.queue;
  up.dock.style.display = "flex";
  const active = items.filter((i) => i.phase === "uploading").length;
  const queued = items.filter((i) => i.phase === "queued").length;
  const done = items.filter((i) => i.phase === "done").length;
  const failed = items.filter((i) => i.phase === "error").length;
  const busy = active + queued;
  const title = busy ? `Uploading ${items.length} item${items.length > 1 ? "s" : ""}` + (active ? ` · ${active} active` : "") : failed ? `${done} uploaded · ${failed} failed` : "Upload complete";
  const head = `<div class="upd-head" data-up-action="toggle">
      <div class="upd-title">${busy ? `<span class="upd-spinner"></span>` : icon("check", { size: 16, cls: "ok-ic" })}<span>${esc(title)}</span></div>
      <div class="upd-overall"><div class="upd-bar"><div id="updOverallFill"></div></div><span class="upd-pct" id="updOverallPct">0%</span></div>
      <div class="upd-btns">${busy ? `<button class="upd-cancelall" data-up-action="cancel-all" title="Cancel all uploads">${icon("x", { size: 14 })} Cancel all</button>` : `<button class="upd-x" data-up-action="clear" title="Clear">${icon("x", { size: 15 })}</button>`}<button class="upd-chev" data-up-action="toggle">${icon("chevronRight", { size: 16, cls: up.expanded ? "down" : "" })}</button></div>
    </div>`;
  const body = up.expanded ? `<div class="upd-body">${items.map(itemRow).join("")}</div>` : "";
  up.dock.innerHTML = head + body;
}
// Move only the moving parts (bar widths + percentages + subtext) without
// rebuilding the DOM. This is what stops the spinner glitching and lets the bar
// actually animate as progress arrives.
function paintUploader() {
  const items = up.queue;
  const totalBytes = items.reduce((n, i) => n + (i.size || 0), 0);
  const weighted = items.reduce((n, i) => n + (taskDisplayPct(i) / 100) * (i.size || 0), 0);
  const pct = totalBytes ? Math.min(100, Math.round((weighted / totalBytes) * 100)) : 0;
  const fill = document.getElementById("updOverallFill");
  if (fill) fill.style.width = pct + "%";
  const pctEl = document.getElementById("updOverallPct");
  if (pctEl) pctEl.textContent = pct + "%";
  for (const i of items) {
    const p = taskDisplayPct(i);
    const f = up.dock.querySelector(`[data-up-fill="${i.id}"]`);
    if (f) f.style.width = p + "%";
    const s = up.dock.querySelector(`[data-up-sub="${i.id}"]`);
    if (s) s.textContent = itemSub(i, p);
  }
}
// Real progress as a 0..1 fraction. Uploads run in two stages — receiving the
// file (browser→server) then sending it (server→Telegram) — each counts as half,
// so the bar advances continuously instead of jumping back between stages.
function taskRaw(i) {
  const total = i.total || i.size || 1;
  const f = Math.max(0, Math.min(1, (i.uploaded || 0) / total));
  return i.stage === "sending" ? 0.5 + f * 0.5 : f * 0.5;
}
// Eased bar fill: the first 60% of real progress races through ~75% of the bar
// (so it feels responsive straight away), then the final 40% trickles through the
// last 25% so it never stalls at 99%. The % starts at 0; the bar itself is given a
// small CSS min-width so it never reads as empty the instant an upload starts.
function taskDisplayPct(i) {
  if (i.phase === "done") return 100;
  if (i.phase !== "uploading") return 0;
  const raw = taskRaw(i);
  const eased = raw <= 0.6 ? (raw / 0.6) * 0.75 : 0.75 + ((raw - 0.6) / 0.4) * 0.25;
  return Math.min(100, Math.round(eased * 100));
}
function itemSub(i, pct) {
  if (i.phase === "queued") return `Queued · ${fmtSize(i.size)}`;
  if (i.phase === "uploading") return i.stage === "sending" ? (i.part ? `Sending part ${i.part} to Telegram · ${pct}%` : `Sending to Telegram · ${pct}%`) : `Uploading · ${pct}%`;
  if (i.phase === "done") return `Done · ${fmtSize(i.size)}`;
  return `Failed: ${i.error || "error"}`;
}
function itemRow(i) {
  const kind = kindOf(i.file && i.file.type, i.name);
  const pct = taskDisplayPct(i);
  // While uploading, show a spinning loader in place of the file-type icon.
  const ic = i.phase === "uploading" ? `<span class="upd-spinner"></span>` : fileIcon(kind, 18);
  const act = i.phase === "error" ? `<button class="upd-ia" data-up-action="retry" data-id="${i.id}" title="Retry">${icon("refresh", { size: 14 })}</button>` : i.phase === "queued" || i.phase === "uploading" ? `<button class="upd-ia" data-up-action="cancel" data-id="${i.id}" title="Cancel">${icon("x", { size: 14 })}</button>` : "";
  return `<div class="upd-item ${i.phase}" data-up-item="${i.id}">
      <div class="upd-iic">${ic}</div>
      <div class="upd-imain"><div class="upd-inm">${esc(i.name)} <span class="upd-ifld">${icon("folder", { size: 11 })} ${esc(folderTitle(i.folderId))}</span></div>
        <div class="upd-isub" data-up-sub="${i.id}">${esc(itemSub(i, pct))}</div>
        <div class="upd-bar sm"><div data-up-fill="${i.id}" style="width:${pct}%"></div></div></div>
      <div class="upd-iact">${act}</div>
    </div>`;
}
function cancelUpload(id) {
  const it = up.queue.find((i) => i.id === id);
  if (!it) return;
  if (it.phase === "queued") {
    it.phase = "error";
    it.error = "Cancelled";
  } else if (it.phase === "uploading") {
    const ctrl = up.ctrl.get(id);
    if (ctrl) {
      try { ctrl.abort(); } catch {}
    } else if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      // orphaned SW upload (started before this page load)
      navigator.serviceWorker.controller.postMessage({ type: "abort", id });
    }
  }
}
function cancelAllUploads() {
  for (const it of up.queue) {
    if (it.phase === "queued") {
      it.phase = "error";
      it.error = "Cancelled";
    } else if (it.phase === "uploading") {
      const ctrl = up.ctrl.get(it.id);
      if (ctrl) {
        try { ctrl.abort(); } catch {}
      } else if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "abort", id: it.id });
      }
    }
  }
}
function retryUpload(id) {
  const it = up.queue.find((i) => i.id === id);
  if (it && it.phase === "error") {
    it.phase = "queued";
    it.error = null;
    it.uploaded = 0;
    kickUploader();
  }
}

/* ---- task lifecycle ---- */
function addUploadTask({ file, name, folderId }) {
  const t = {
    id: (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)),
    name,
    file,
    folderId,
    size: file.size,
    uploaded: 0,
    total: file.size,
    phase: "queued",
    error: null,
    part: null,
  };
  up.queue.push(t);
  mountUploader();
  scheduleUpRender();
  kickUploader();
  return t;
}
function enqueueFiles(fileList, folderId) {
  let n = 0;
  for (const file of fileList) {
    addUploadTask({ file, name: file.name, folderId });
    n++;
  }
  return n;
}
function kickUploader() {
  while (up.active < up.concurrency) {
    const t = up.queue.find((i) => i.phase === "queued");
    if (!t) break;
    runTask(t);
  }
}
async function runTask(t) {
  t.phase = "uploading";
  up.active++;
  scheduleUpRender();
  const ctrl = new AbortController();
  up.ctrl.set(t.id, ctrl);
  try {
    await uploadTask(t, ctrl.signal);
    t.phase = "done";
    t.uploaded = t.total;
  } catch (e) {
    if (t.phase !== "error") {
      t.phase = "error";
      t.error = e && e.name === "AbortError" ? "Cancelled" : e?.message || "Failed";
    }
  } finally {
    up.ctrl.delete(t.id);
    up.active--;
    scheduleUpRender();
    maybeRefreshCurrentFolder(t.folderId);
    kickUploader();
  }
}
function uploadTask(t, signal) {
  return new Promise((resolve, reject) => {
    const job = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      try { t._es && t._es.close(); } catch {}
      signal && signal.removeEventListener("abort", onAbort);
      err ? reject(err) : resolve();
    };
    t._finish = finish;
    t.jobId = job;
    const onAbort = () => {
      // If the upload is running in the service worker, ask it to abort.
      if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: "abort", id: t.id });
      finish(Object.assign(new Error("Cancelled"), { name: "AbortError" }));
    };
    signal && signal.addEventListener("abort", onAbort);

    // Live progress via SSE while the page is open (best-effort; navigation closes it).
    const es = new EventSource(`/api/files/upload/progress?job=${job}`);
    t._es = es;
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.error) return finish(new Error(d.error));
        if (d.phase === "receiving") {
          t.stage = "receiving";
          t.uploaded = Number(d.received) || t.uploaded;
          t.total = Number(d.size) || t.total;
          scheduleUpRender();
        } else if (d.phase === "sending") {
          t.stage = "sending";
          t.uploaded = Number(d.uploaded) || 0;
          t.total = Number(d.total) || t.total;
          t.part = d.multipart ? d.part : null;
          scheduleUpRender();
        }
      } catch {}
    };
    es.onerror = () => {};

    const headers = { "X-Job": job, "X-Filename": encodeURIComponent(t.name), "X-Filesize": t.size, "X-Force-Document": "1", "Content-Type": "application/octet-stream" };
    if (swActive && navigator.serviceWorker && navigator.serviceWorker.controller) {
      // Hand the upload to the service worker so it survives page navigation.
      navigator.serviceWorker.controller.postMessage({
        type: "upload", id: t.id, url: `/api/files/upload?folder=${t.folderId}`,
        file: t.file, headers, name: t.name, folderId: t.folderId, size: t.size, jobId: job,
      });
      // completion is signalled by onSwUploadStatus -> t._finish
    } else {
      fetch(`/api/files/upload?folder=${t.folderId}`, {
        method: "POST",
        credentials: "include",
        signal,
        headers,
        body: t.file,
      })
        .then(async (r) => {
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            finish(new Error(j.error || "Upload failed"));
          } else {
            finish();
          }
        })
        .catch((err) => finish(err));
    }
  });
}
let upRefreshTimer = null;
function maybeRefreshCurrentFolder(folderId) {
  if (!state.currentFolder || state.currentFolder !== folderId || state.currentView) return;
  clearTimeout(upRefreshTimer);
  upRefreshTimer = setTimeout(() => loadFiles(true), 600);
}

/* ---- service worker: keep uploads alive across navigation ----
   The upload POST is handed to a service worker, which the browser keeps running
   even when the page navigates. So you can move around the app (or away) while a
   large file transfers; on return, in-progress and just-finished uploads are
   restored from the worker. Closing the browser entirely still stops them. */
let swActive = false;
function initServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("message", onSwUploadStatus);
  if (navigator.serviceWorker.controller) swActive = true;
  navigator.serviceWorker.ready.then(() => {
    swActive = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      // Reclaim uploads already in flight (started before this page loaded).
      navigator.serviceWorker.controller.postMessage({ type: "sync" });
    }
  });
}
function onSwUploadStatus(e) {
  const j = e.data && e.data.job;
  if (!j) return;
  let t = up.queue.find((i) => i.id === j.id);
  if (!t) {
    // Orphaned upload from a previous page load — re-display it.
    t = {
      id: j.id, name: j.name || "Uploading…", folderId: j.folderId, size: j.size || 0,
      uploaded: 0, total: j.size || 0, file: null, phase: "uploading", error: null, part: null,
    };
    up.queue.push(t);
    mountUploader();
    if (j.status === "uploading" && j.jobId) {
      const es = new EventSource(`/api/files/upload/progress?job=${j.jobId}`);
      t._es = es;
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          if (d.phase === "receiving") { t.stage = "receiving"; t.uploaded = Number(d.received) || t.uploaded; t.total = Number(d.size) || t.total; }
          else if (d.phase === "sending") { t.stage = "sending"; t.uploaded = Number(d.uploaded) || 0; t.total = Number(d.total) || t.total; t.part = d.multipart ? d.part : null; }
          scheduleUpRender();
        } catch {}
      };
      es.onerror = () => {};
    }
  }
  if (j.status === "done") {
    t.phase = "done";
    t.uploaded = t.total;
    try { t._es && t._es.close(); } catch {}
    if (t._finish) t._finish();
    scheduleUpRender();
    maybeRefreshCurrentFolder(t.folderId);
  } else if (j.status === "error" || j.status === "aborted") {
    t.phase = "error";
    t.error = j.error || "Failed";
    try { t._es && t._es.close(); } catch {}
    if (t._finish) t._finish(new Error(t.error));
    scheduleUpRender();
  }
}

/* ---- subfolder creation + folder tree refresh ---- */
async function ensureSubfolder(title, parentId) {
  const key = parentId + "|" + title;
  if (subCache.has(key)) return subCache.get(key);
  const existing = state.folders.find((f) => f.parentId === parentId && f.title === title);
  if (existing) {
    subCache.set(key, existing.id);
    return existing.id;
  }
  try {
    const r = await api("/api/folders", { method: "POST", body: JSON.stringify({ title, parentId }) });
    subCache.set(key, r.id);
    scheduleFoldersRefresh();
    return r.id;
  } catch (e) {
    // degrade gracefully: drop contents into the parent folder
    subCache.set(key, parentId);
    return parentId;
  }
}
async function ensureFolderPath(parts, rootId) {
  let parentId = rootId;
  for (const part of parts) parentId = await ensureSubfolder(part, parentId);
  return parentId;
}
let foldersRefreshTimer = null;
function scheduleFoldersRefresh() {
  clearTimeout(foldersRefreshTimer);
  foldersRefreshTimer = setTimeout(refreshFolders, 700);
}
async function refreshFolders() {
  try {
    const r = await api("/api/folders");
    state.folders = r.folders;
    renderSidebar();
    if (state.currentFolder && !state.currentView) renderSubfolders();
  } catch {}
}

/* ---- pickers ---- */
function pickUpload() {
  if (!state.currentFolder) return toast("Open a folder first");
  const inp = el(`<input type="file" multiple hidden />`);
  document.body.appendChild(inp);
  inp.onchange = () => {
    if (inp.files.length) enqueueFiles([...inp.files], state.currentFolder);
    inp.remove();
  };
  inp.click();
}
window.pickUpload = pickUpload;
async function pickUploadFolder() {
  if (!state.currentFolder) return toast("Open a folder first");
  const inp = el(`<input type="file" webkitdirectory directory multiple hidden />`);
  document.body.appendChild(inp);
  inp.onchange = async () => {
    const files = [...inp.files];
    inp.remove();
    if (!files.length) return;
    toast(`Preparing ${files.length} file${files.length > 1 ? "s" : ""}…`);
    for (const file of files) {
      const parts = (file.webkitRelativePath || file.name).split("/").slice(0, -1).filter(Boolean);
      let folderId = state.currentFolder;
      try {
        folderId = await ensureFolderPath(parts, state.currentFolder);
      } catch {}
      addUploadTask({ file, name: file.name, folderId });
    }
  };
  inp.click();
}
window.pickUploadFolder = pickUploadFolder;

/* ---- drag & drop anywhere, with directory support ---- */
let dropOverlay = null;
let dragDepth = 0;
function showDropOverlay() {
  if (!dropOverlay) {
    dropOverlay = el(`<div id="dropOverlay" class="drop-overlay"><div class="drop-card">${icon("uploadCloud", { size: 40 })}<div class="drop-msg">Drop to upload to <b id="dropFld"></b></div><div class="drop-hint">Folders keep their structure</div></div></div>`);
    document.body.appendChild(dropOverlay);
  }
  const f = state.folders.find((x) => x.id === state.currentFolder);
  const fld = dropOverlay.querySelector("#dropFld");
  if (fld) fld.textContent = f?.title || "current folder";
  dropOverlay.classList.add("show");
}
function hideDropOverlay() {
  dropOverlay?.classList.remove("show");
  dragDepth = 0;
}
function entryFile(entry) {
  return new Promise((res, rej) => entry.file(res, rej));
}
function readDirAll(reader) {
  return new Promise((res) => {
    const out = [];
    const read = () =>
      reader.readEntries(
        (batch) => {
          if (!batch.length) res(out);
          else {
            out.push(...batch);
            read();
          }
        },
        () => res(out)
      );
    read();
  });
}
async function ingestEntries(entries, rootFolderId) {
  for (const entry of entries) {
    try {
      await processEntry(entry, rootFolderId);
    } catch {}
  }
}
async function processEntry(entry, parentFolderId) {
  if (entry.isFile) {
    const file = await entryFile(entry);
    addUploadTask({ file, name: file.name, folderId: parentFolderId });
  } else if (entry.isDirectory) {
    const subId = await ensureSubfolder(entry.name, parentFolderId);
    const children = await readDirAll(entry.createReader());
    for (const c of children) await processEntry(c, subId);
  }
}
document.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
  if (!state.currentFolder) return;
  e.preventDefault();
  dragDepth++;
  showDropOverlay();
});
document.addEventListener("dragover", (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault();
});
document.addEventListener("dragleave", () => {
  if (dragDepth > 0) dragDepth--;
  if (dragDepth <= 0) hideDropOverlay();
});
document.addEventListener("drop", async (e) => {
  if (!e.dataTransfer) return;
  const hasFiles = [...e.dataTransfer.types].includes("Files") || e.dataTransfer.files?.length;
  if (!hasFiles) return;
  e.preventDefault();
  hideDropOverlay();
  const folderId = state.currentFolder;
  if (!folderId) return toast("Open a folder to upload into");
  const items = e.dataTransfer.items;
  if (items && items.length && typeof items[0].webkitGetAsEntry === "function") {
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const en = items[i].webkitGetAsEntry();
      if (en) entries.push(en);
    }
    if (entries.some((x) => x.isDirectory)) return ingestEntries(entries, folderId);
  }
  enqueueFiles([...(e.dataTransfer.files || [])], folderId);
});
function kindOf(mime, name) {
  if (mime?.startsWith("image/")) return "image";
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || name?.endsWith(".pdf")) return "pdf";
  return "file";
}

/* ===================== folders ===================== */
async function newFolder(parentId) {
  const title = await uiPrompt({
    title: parentId ? "New subfolder" : "New folder",
    label: parentId ? "Subfolders are stored as Telegram channels inside this folder." : "Creates a Telegram channel used as a folder.",
    placeholder: parentId ? "Subfolder name" : "My folder",
    value: parentId ? "Subfolder" : "My folder",
    okText: "Create",
    validate: (v) => (!v || !v.trim() ? "Name cannot be empty" : v.length > 80 ? "Too long" : null),
  });
  if (!title) return;
  try {
    const body = { title: title.trim() };
    if (parentId) body.parentId = parentId;
    await api("/api/folders", { method: "POST", body: JSON.stringify(body) });
    await refreshFolders();
    toast(parentId ? "Subfolder created" : "Folder created");
  } catch (err) {
    uiAlert(err.message, { title: "Couldn't create folder" });
  }
}
window.newFolder = newFolder;

async function deleteFolder(id) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return;
  const hasKids = state.folders.some((x) => x.parentId === id);
  if (!(await uiConfirm(`“${f.title}”${hasKids ? " and all subfolders inside it" : ""} will be removed from your drive.`, { title: "Delete folder?", okText: "Delete", danger: true, icon: icon("trash", { size: 20 }) }))) return;
  try {
    await api("/api/folders/" + id, { method: "DELETE" });
    const chain = folderChain(state.currentFolder).map((x) => x.id);
    if (chain.includes(id)) {
      const upId = folderChain(id).length > 1 ? folderChain(id)[folderChain(id).length - 2].id : null;
      state.currentFolder = null;
      if (upId) await openFolder(upId);
      else await loadFolders();
    } else {
      await refreshFolders();
      if (state.currentFolder && !state.currentView) renderSubfolders();
    }
    toast("Folder deleted");
  } catch (err) {
    uiAlert(err.message, { title: "Delete failed" });
  }
}
window.deleteFolder = deleteFolder;

function folderChain(id) {
  const chain = [];
  let cur = state.folders.find((f) => f.id === id);
  let guard = 0;
  while (cur && guard++ < 50) {
    chain.unshift(cur);
    cur = cur.parentId ? state.folders.find((f) => f.id === cur.parentId) : null;
  }
  return chain;
}

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
  if (!(await uiConfirm("This share link will stop working immediately.", { title: "Delete share link?", okText: "Delete", danger: true, icon: icon("trash", { size: 20 }) }))) return;
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
  const label = await uiPrompt({ title: "New API key", label: "A label to remember what this key is for.", placeholder: "My app", value: "My app", okText: "Create" });
  if (!label) return;
  const r = await api("/api/keys", { method: "POST", body: JSON.stringify({ label, account: acc }) });
  const ok = await copyText(r.key);
  showKeyModal(r.key, ok);
  viewKeys();
};
function showKeyModal(key, copied) {
  const card = el(`<div class="modal card-modal gd-dialog">
    <div class="gd-dialog-body">
      <div class="gd-dlg-ic">${icon("keyRound", { size: 22 })}</div>
      <div class="gd-dlg-title">API key created</div>
      <div class="gd-dlg-msg">Copy it now — it won't be shown again.</div>
      <div class="gd-dlg-field"><input id="kv" readonly value="${esc(key)}" /><button class="btn-2" id="kcopy" style="margin-top:8px">${icon("copy", { size: 15 })} ${copied ? "Copied" : "Copy"}</button></div>
    </div>
    <div class="gd-dialog-actions"><button class="primary" id="kdone">Done</button></div>
  </div>`);
  const bg = modalOverlay(card);
  const inp = card.querySelector("#kv");
  setTimeout(() => inp.focus(), 30);
  card.querySelector("#kcopy").onclick = async () => { const o = await copyText(key); card.querySelector("#kcopy").innerHTML = icon("copy", { size: 15 }) + " " + (o ? "Copied" : "Copy"); };
  card.querySelector("#kdone").onclick = () => bg._close();
}
window.delKey = async (id) => {
  if (!(await uiConfirm("Apps using this key will lose access immediately.", { title: "Revoke API key?", okText: "Revoke", danger: true, icon: icon("trash", { size: 20 }) }))) return;
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
      if (!(await uiConfirm("The custom logo will be removed and the default mark used.", { title: "Remove logo?", okText: "Remove", danger: true, icon: icon("trash", { size: 20 }) }))) return;
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
  if (!(await uiConfirm("This removes the account and its folders from the drive. Your files stay in Telegram.", { title: "Remove account?", okText: "Remove", danger: true, icon: icon("trash", { size: 20 }) }))) return;
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
  const v = await userFormModal();
  if (!v) return;
  try {
    await api("/api/users", { method: "POST", body: JSON.stringify(v) });
    toast("User created");
    viewUsers();
  } catch (err) {
    uiAlert(err.message, { title: "Couldn't create user" });
  }
};
function userFormModal() {
  return new Promise((resolve) => {
    const card = el(`<div class="modal card-modal gd-dialog">
      <div class="gd-dialog-body">
        <div class="gd-dlg-ic">${icon("userPlus", { size: 22 })}</div>
        <div class="gd-dlg-title">New user</div>
        <div class="gd-dlg-field"><input id="ufU" placeholder="Username" autofocus /></div>
        <div class="gd-dlg-field"><input id="ufP" type="password" placeholder="Password" /></div>
        <label class="gd-check"><input type="checkbox" id="ufA" /><span>Make this user an admin</span></label>
        <div class="err" id="ufE"></div>
      </div>
      <div class="gd-dialog-actions"><button class="btn-2" id="ufNo">Cancel</button><button class="primary" id="ufYes">Create</button></div>
    </div>`);
    const bg = modalOverlay(card);
    const U = card.querySelector("#ufU"), P = card.querySelector("#ufP"), A = card.querySelector("#ufA"), E = card.querySelector("#ufE");
    setTimeout(() => U.focus(), 30);
    const submit = () => {
      const u = U.value.trim().toLowerCase();
      const p = P.value;
      if (!/^[a-z0-9_.-]{3,32}$/i.test(u)) return (E.textContent = "Username must be 3-32 chars (letters, numbers, _ . -)");
      if (p.length < 4) return (E.textContent = "Password must be at least 4 characters");
      bg._close();
      resolve({ username: u, password: p, role: A.checked ? "admin" : "user" });
    };
    const cancel = () => { bg._close(); resolve(null); };
    card.querySelector("#ufYes").onclick = submit;
    card.querySelector("#ufNo").onclick = cancel;
    [U, P].forEach((i) => (i.onkeydown = (e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") cancel(); }));
  });
}
window.resetUserPw = async (id, name) => {
  const password = await uiPrompt({ title: "Reset password", label: `New password for ${name}.`, placeholder: "New password", okText: "Update", validate: (v) => (!v || v.length < 4 ? "Must be at least 4 characters" : null) });
  if (!password) return;
  try {
    await api("/api/users/" + id, { method: "PATCH", body: JSON.stringify({ password }) });
    toast("Password updated");
  } catch (err) {
    uiAlert(err.message, { title: "Failed" });
  }
};
window.toggleUserRole = async (id, role) => {
  const next = role === "admin" ? "user" : "admin";
  try {
    await api("/api/users/" + id, { method: "PATCH", body: JSON.stringify({ role: next }) });
    viewUsers();
  } catch (err) {
    uiAlert(err.message, { title: "Failed" });
  }
};
window.delUser = async (id, name) => {
  if (!(await uiConfirm(`User “${name}” will be deleted and can no longer sign in.`, { title: "Delete user?", okText: "Delete", danger: true, icon: icon("trash", { size: 20 }) }))) return;
  try {
    await api("/api/users/" + id, { method: "DELETE" });
    viewUsers();
  } catch (err) {
    uiAlert(err.message, { title: "Failed" });
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

initServiceWorker();
boot();
