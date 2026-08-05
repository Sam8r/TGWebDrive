import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { stmt } from "../db.js";
import { uid } from "../util.js";

const OPTS = { connectionRetries: 5, useWSS: true, retryDelay: 1000, autoReconnect: true };

// accountId -> { client, promise, lastUsed }
const clients = new Map();
// tempToken -> { client, apiId, apiHash, phone, phoneCodeHash, createdAt }
const logins = new Map();

function buildSession(sessionStr, apiId, apiHash) {
  return new TelegramClient(new StringSession(sessionStr || ""), apiId, apiHash, OPTS);
}

async function connect(c) {
  if (!c.connected) await c.connect();
  return c;
}

export async function getConnectedClient(accountId) {
  let entry = clients.get(accountId);
  if (entry) {
    entry.lastUsed = Date.now();
    try {
      if (!entry.client.connected) await entry.client.connect();
      return entry.client;
    } catch (e) {
      clients.delete(accountId);
    }
  }
  const acc = stmt.getAccount.get(accountId);
  if (!acc) throw new HttpError(404, "Account not found");
  const client = buildSession(acc.session, acc.api_id, acc.api_hash);
  await connect(client);
  // verify session still valid
  let ok = false;
  try {
    ok = await client.isUserAuthorized();
  } catch {
    ok = false;
  }
  if (!ok) throw new HttpError(401, "Telegram session expired — please log in again");
  entry = { client, lastUsed: Date.now() };
  clients.set(accountId, entry);
  stmt.touchAccount.run(Date.now(), accountId);
  return client;
}

export function dropClient(accountId) {
  const entry = clients.get(accountId);
  if (entry) {
    try {
      entry.client.disconnect();
    } catch {}
    clients.delete(accountId);
  }
}

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/* ---------------- Login flow ---------------- */

export async function beginLogin(apiId, apiHash, phone) {
  apiId = Number(apiId);
  const client = buildSession("", apiId, apiHash);
  await connect(client);
  let sent;
  try {
    sent = await client.sendCode({ apiId, apiHash }, phone);
  } catch (e) {
    await safeDisconnect(client);
    throw mapTgError(e);
  }
  const tempToken = uid() + uid();
  logins.set(tempToken, {
    client,
    apiId,
    apiHash,
    phone,
    phoneCodeHash: sent.phoneCodeHash,
    isCodeViaApp: sent.isCodeViaApp,
    createdAt: Date.now(),
  });
  return { tempToken, isCodeViaApp: !!sent.isCodeViaApp };
}

export async function resendCode(tempToken) {
  const L = logins.get(tempToken);
  if (!L) throw new HttpError(400, "Login session expired");
  try {
    const r = await L.client.sendCode({ apiId: L.apiId, apiHash: L.apiHash }, L.phone);
    L.phoneCodeHash = r.phoneCodeHash;
    L.isCodeViaApp = r.isCodeViaApp;
    return { isCodeViaApp: !!r.isCodeViaApp };
  } catch (e) {
    throw mapTgError(e);
  }
}

export async function finishLogin(tempToken, code, password) {
  const L = logins.get(tempToken);
  if (!L) throw new HttpError(400, "Login session expired. Start again.");
  const { client, apiId, apiHash, phone, phoneCodeHash } = L;
  try {
    try {
      await client.invoke(
        new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: String(code) })
      );
    } catch (e) {
      if (e.errorMessage !== "SESSION_PASSWORD_NEEDED") throw e;
      if (!password) {
        const err = new HttpError(449, "Two-factor authentication required");
        err.code = "2FA_NEEDED";
        throw err;
      }
      await do2FA(client, password);
    }

    const me = await client.getMe();
    const sessionStr = client.session.save();
    const id = uid();
    const now = Date.now();
    stmt.addAccount.run({
      id,
      label: [me.firstName, me.lastName].filter(Boolean).join(" ") || me.username || phone || "Account",
      phone,
      user_id: String(me.id),
      username: me.username || null,
      api_id: apiId,
      api_hash: apiHash,
      session: sessionStr,
      is_premium: me.premium ? 1 : 0,
      created_at: now,
      last_used_at: now,
    });
    clients.set(id, { client, lastUsed: now });
    logins.delete(tempToken);
    return { id, me: { name: stmt.getAccount.get(id).label, username: me.username || null, phone, premium: !!me.premium } };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw mapTgError(e);
  }
}

async function do2FA(client, password) {
  const srp = await client.invoke(new Api.account.GetPassword());
  const computed = await computeCheck(srp, password);
  await client.invoke(new Api.auth.CheckPassword({ password: computed }));
}

async function computeCheck(srp, password) {
  const mod = await import("telegram/Password.js");
  const fn = mod.computeCheck || mod.default?.computeCheck;
  if (!fn) throw new Error("computeCheck unavailable in this telegram build");
  return fn(srp, password);
}

export function cancelLogin(tempToken) {
  const L = logins.get(tempToken);
  if (L) {
    safeDisconnect(L.client);
    logins.delete(tempToken);
  }
}

async function safeDisconnect(c) {
  try {
    await c.disconnect();
  } catch {}
}

function mapTgError(e) {
  const msg = e.errorMessage || e.message || "Telegram error";
  let status = 400;
  if (/FLOOD_WAIT_(\d+)/.test(msg)) {
    const s = Number(RegExp.$1);
    return new HttpError(429, `Telegram asks to wait ${s}s before retrying`);
  }
  if (msg.includes("PHONE_NUMBER_INVALID")) return new HttpError(400, "Phone number is invalid");
  if (msg.includes("API_ID_INVALID")) return new HttpError(400, "API ID / API hash are invalid");
  if (msg.includes("PHONE_CODE_INVALID")) return new HttpError(400, "Wrong login code");
  if (msg.includes("PHONE_CODE_EXPIRED")) return new HttpError(400, "Login code expired. Request a new one.");
  if (msg.includes("PASSWORD_HASH_INVALID")) return new HttpError(400, "Wrong 2FA password");
  if (msg.includes("SESSION_REVOKED") || msg.includes("AUTH_KEY_UNREGISTERED"))
    return new HttpError(401, "Session revoked. Please log in again.");
  return new HttpError(status, msg);
}

// housekeeping: expire stale logins every 10 min
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, L] of logins) {
    if (L.createdAt < cutoff) {
      safeDisconnect(L.client);
      logins.delete(k);
    }
  }
}, 10 * 60 * 1000).unref();
