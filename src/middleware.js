import { metaGet, metaSet, stmt } from "./db.js";
import { verifyPassword, token } from "./util.js";

// Sessions are persisted in SQLite so server restarts no longer log people out.
// A "remember me" login opts into the longer-lived cookie/session.
const TTL_REMEMBER = 1000 * 60 * 60 * 24 * 90; // 90 days
const TTL_SESSION = 1000 * 60 * 60 * 24 * 1; // 1 day

// Purge expired sessions occasionally.
function gc() {
  try {
    stmt.deleteExpiredSessions.run(Date.now());
  } catch {}
}
setInterval(gc, 60 * 60 * 1000).unref();

// cookies are marked secure when served over HTTPS via the proxy
function cookieSecure(req) {
  return !!(req.secure || req.protocol === "https" || req.headers["x-forwarded-proto"] === "https");
}

export function createSession(req, res, user, { remember = false } = {}) {
  const sid = token(24);
  const now = Date.now();
  const ttl = remember ? TTL_REMEMBER : TTL_SESSION;
  stmt.addSession.run({
    sid,
    user_id: user.id,
    username: user.username,
    role: user.role,
    current_account_id: null,
    created_at: now,
    expires_at: now + ttl,
  });
  setCookie(req, res, sid, ttl);
  return sid;
}

export function setCookie(req, res, sid, ttlMs = TTL_SESSION) {
  res.cookie("sid", sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(req),
    maxAge: ttlMs,
    path: "/",
  });
}

export function getSession(req) {
  const sid = req.cookies?.sid;
  if (!sid) return null;
  const row = stmt.getSession.get(sid);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    stmt.deleteSession.run(sid);
    return null;
  }
  return {
    sid,
    userId: row.user_id,
    username: row.username,
    role: row.role,
    currentAccountId: row.current_account_id || null,
    createdAt: row.created_at,
  };
}

export function updateSession(req, patch) {
  const sid = req.cookies?.sid;
  if (!sid) return;
  if (patch && Object.prototype.hasOwnProperty.call(patch, "currentAccountId")) {
    stmt.updateSessionRow.run({ sid, current_account_id: patch.currentAccountId ?? null });
  }
}

export function destroySession(req, res) {
  const sid = req.cookies?.sid;
  if (sid) stmt.deleteSession.run(sid);
  res.clearCookie("sid", { path: "/" });
}

export function destroyUserSessions(userId) {
  stmt.deleteSessionsByUser.run(userId);
}

export function isSetup() {
  return stmt.countUsers.get().c > 0;
}

export async function requireAppAuth(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: "Not authenticated", needsLogin: true });
  req.session = s;
  req.user = { id: s.userId, username: s.username, role: s.role };
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}

export function requireAccount(req, res, next) {
  const accId = req.session.currentAccountId || req.headers["x-account"] || req.query.account;
  if (!accId) return res.status(409).json({ error: "No Telegram account selected", noAccount: true });
  req.accountId = accId;
  next();
}

export { metaGet, metaSet, verifyPassword };
