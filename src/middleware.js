import { randomUUID } from "node:crypto";
import { metaGet, metaSet, stmt } from "./db.js";
import { verifyPassword, token } from "./util.js";

// in-memory sessions: token -> { userId, username, role, currentAccountId, createdAt }
const sessions = new Map();
const SESSION_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days

function gc() {
  const now = Date.now();
  for (const [k, v] of sessions) if (now - v.createdAt > SESSION_TTL) sessions.delete(k);
}
setInterval(gc, 60 * 60 * 1000).unref();

// cookies are marked secure when served over HTTPS via the proxy

export function createSession(req, res, user) {
  const sid = token(24);
  sessions.set(sid, { userId: user.id, username: user.username, role: user.role, currentAccountId: null, createdAt: Date.now() });
  setCookie(req, res, sid);
  return sid;
}
export function setCookie(req, res, sid) {
  const secure = req.secure || req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";
  res.cookie("sid", sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: !!secure,
    maxAge: SESSION_TTL,
    path: "/",
  });
}

export function getSession(req) {
  const sid = req.cookies?.sid;
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL) {
    sessions.delete(sid);
    return null;
  }
  return { sid, ...s };
}
export function updateSession(req, patch) {
  const sid = req.cookies?.sid;
  if (!sid) return;
  const s = sessions.get(sid);
  if (!s) return;
  sessions.set(sid, { ...s, ...patch });
}
export function destroySession(req, res) {
  const sid = req.cookies?.sid;
  if (sid) sessions.delete(sid);
  res.clearCookie("sid", { path: "/" });
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

export { sessions, metaGet, metaSet, verifyPassword };
