import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import archiver from "archiver";
import { stmt } from "../db.js";
import { requireAppAuth, requireAccount } from "../middleware.js";
import { getConnectedClient } from "../tg/manager.js";
import { buildPeer, getOne, serializeMessage, serializeMultipart, parseParts, streamToResponse, streamMultipart, streamThumb, listMessages } from "../tg/operations.js";
import { config } from "../config.js";
import { hashPassword, verifyPassword, shortId, safeFilename } from "../util.js";

export const share = Router(); // mounted under /api  (metadata + management)
export const pubBin = Router(); // mounted at root (binary streams + zip)

const b64 = (b) => Buffer.from(b).toString("base64url");
function signAccess(shareId, ttlSec = 3600 * 6) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${shareId}.${exp}`;
  const sig = b64(createHmac("sha256", config.secret).update(payload).digest());
  return `${payload}.${sig}`;
}
function verifyAccess(tok, shareId) {
  if (!tok) return false;
  const parts = tok.split(".");
  if (parts.length !== 3) return false;
  const [sid, exp, sig] = parts;
  if (sid !== shareId) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expect = b64(createHmac("sha256", config.secret).update(`${sid}.${exp}`).digest());
  try {
    return sig.length === expect.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
  } catch {
    return false;
  }
}

function publicShare(s) {
  return {
    id: s.id,
    kind: s.kind || "file",
    name: s.name,
    mime: s.mime,
    size: s.size,
    needsPassword: !!s.password_hash,
    expiresAt: s.expires_at,
    expired: s.expires_at && s.expires_at < Date.now(),
    createdAt: s.created_at,
    downloads: s.downloads,
  };
}

function loadShareOrDeny(req, res) {
  const s = stmt.getShare.get(req.params.id);
  if (!s) {
    res.status(404).json({ error: "Share not found" });
    return null;
  }
  if (s.expires_at && s.expires_at < Date.now()) {
    res.status(410).json({ error: "Share expired" });
    return null;
  }
  const token = req.query.token || req.headers["x-share-token"];
  if (s.password_hash && !verifyAccess(token, s.id)) {
    res.status(401).json({ error: "Password required", needsPassword: true });
    return null;
  }
  return s;
}

/* ============ metadata + management (under /api) ============ */

share.get("/public/share/:id", (req, res) => {
  const s = stmt.getShare.get(req.params.id);
  if (!s) return res.status(404).json({ error: "Share not found" });
  if (s.expires_at && s.expires_at < Date.now()) return res.status(410).json({ error: "Share expired" });
  res.json(publicShare(s));
});

share.post("/public/share/:id/access", (req, res) => {
  const s = stmt.getShare.get(req.params.id);
  if (!s) return res.status(404).json({ error: "Share not found" });
  if (s.expires_at && s.expires_at < Date.now()) return res.status(410).json({ error: "Share expired" });
  if (!s.password_hash) return res.json({ token: signAccess(s.id) });
  if (!verifyPassword(String(req.body?.password || ""), s.password_hash))
    return res.status(401).json({ error: "Wrong password" });
  res.json({ token: signAccess(s.id) });
});

share.get("/public/share/:id/files", async (req, res, next) => {
  try {
    const s = loadShareOrDeny(req, res);
    if (!s) return;
    if ((s.kind || "file") !== "folder") return res.status(400).json({ error: "Not a folder share" });
    const client = await getConnectedClient(s.account_id);
    const peer = buildPeer({ peer_json: s.peer_json });
    const r = await listMessages(client, peer, { limit: 200 });
    const token = encodeURIComponent(req.query.token || "");
    const items = r.items.map((f) => ({
      ...f,
      rawUrl: `/s/${s.id}/file/${f.id}/raw${token ? "?token=" + token : ""}`,
      thumbUrl: `/s/${s.id}/file/${f.id}/thumb${token ? "?token=" + token : ""}`,
    }));
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

share.get("/shares", requireAppAuth, requireAccount, (req, res) => {
  const list = stmt.listShares
    .all()
    .filter((s) => s.account_id === req.accountId)
    .map((s) => ({ ...publicShare(s), url: `${config.publicUrl}/s/${s.id}` }));
  res.json({ shares: list });
});

share.get("/shares/for", requireAppAuth, requireAccount, (req, res) => {
  const row = stmt.getFolder.get(req.query.folder, req.accountId);
  if (!row) return res.status(404).json({ error: "Folder not found" });
  let s;
  if (req.query.multipartId) {
    s = stmt.getShareByMultipart.get(req.accountId, row.peer_json, String(req.query.multipartId));
  } else {
    s = stmt.getShareByFile.get(req.accountId, row.peer_json, Number(req.query.msgId));
  }
  if (!s) return res.json({ none: true });
  res.json({ share: { ...publicShare(s), url: `${config.publicUrl}/s/${s.id}` } });
});

share.get("/shares/forFolder", requireAppAuth, requireAccount, (req, res) => {
  const row = stmt.getFolder.get(req.query.folder, req.accountId);
  if (!row) return res.status(404).json({ error: "Folder not found" });
  const s = stmt.getFolderShare.get(req.accountId, row.peer_json);
  if (!s) return res.json({ none: true });
  res.json({ share: { ...publicShare(s), url: `${config.publicUrl}/s/${s.id}` } });
});

share.post("/shares", requireAppAuth, requireAccount, (req, res, next) => {
  try {
    const { folder, msgId, multipartId, name, mime, size, password, expiresInHours, kind, title } = req.body || {};
    const row = stmt.getFolder.get(folder, req.accountId);
    if (!row) return res.status(404).json({ error: "Folder not found" });
    const shareKind = kind === "folder" ? "folder" : "file";
    const expiresAt = expiresInHours ? Date.now() + Number(expiresInHours) * 3600 * 1000 : null;
    const id = shortId(10);

    if (shareKind === "folder") {
      stmt.deleteFolderShares.run(req.accountId, row.peer_json);
      stmt.addShare.run({
        id, account_id: req.accountId, peer_json: row.peer_json, msg_id: null, multipart_id: null,
        name: title || row.title || "Folder", mime: null, size: null,
        password_hash: password ? hashPassword(password) : null, expires_at: expiresAt,
        created_at: Date.now(), kind: "folder",
      });
    } else if (multipartId) {
      // a split (multipart) file shared as one logical file
      const mp = stmt.getMultipart.get(String(multipartId));
      if (!mp || mp.account_id !== req.accountId) return res.status(404).json({ error: "File not found" });
      stmt.deleteSharesByMultipart.run(String(multipartId));
      stmt.addShare.run({
        id, account_id: req.accountId, peer_json: row.peer_json, msg_id: null, multipart_id: String(multipartId),
        name: name || mp.name || null, mime: mime || mp.mime || null, size: size || mp.size || null,
        password_hash: password ? hashPassword(password) : null, expires_at: expiresAt,
        created_at: Date.now(), kind: "file",
      });
    } else {
      if (!msgId) return res.status(400).json({ error: "msgId required" });
      stmt.deleteSharesByFile.run(req.accountId, row.peer_json, Number(msgId));
      stmt.addShare.run({
        id, account_id: req.accountId, peer_json: row.peer_json, msg_id: Number(msgId), multipart_id: null,
        name: name || null, mime: mime || null, size: size || null,
        password_hash: password ? hashPassword(password) : null, expires_at: expiresAt,
        created_at: Date.now(), kind: "file",
      });
    }
    res.json({ ok: true, id, kind: shareKind, url: `${config.publicUrl}/s/${id}`, expiresAt });
  } catch (e) {
    next(e);
  }
});

share.delete("/shares/:id", requireAppAuth, requireAccount, (req, res) => {
  const s = stmt.getShare.get(req.params.id);
  if (s && s.account_id === req.accountId) stmt.deleteShare.run(req.params.id);
  res.json({ ok: true });
});

/* ============ binary streams + zip (mounted at root) ============ */

// file share: raw + thumb
pubBin.get("/s/:id/raw", async (req, res, next) => {
  try {
    const s = loadShareOrDeny(req, res);
    if (!s) return;
    const client = await getConnectedClient(s.account_id);
    const peer = buildPeer({ peer_json: s.peer_json });
    stmt.incShareDownload.run(s.id);
    if (s.multipart_id) {
      const mp = stmt.getMultipart.get(s.multipart_id);
      if (!mp) return res.status(404).end();
      return await streamMultipart(client, peer, parseParts(mp), Number(mp.size), req, res, {
        attachment: req.query.dl === "1",
        name: s.name || mp.name,
        mime: s.mime || mp.mime,
      });
    }
    const msg = await getOne(client, peer, s.msg_id);
    await streamToResponse(client, msg, req, res, { attachment: req.query.dl === "1", name: s.name, mime: s.mime });
  } catch (e) {
    if (!res.headersSent) next(e);
  }
});

pubBin.get("/s/:id/thumb", async (req, res, next) => {
  try {
    const s = loadShareOrDeny(req, res);
    if (!s) return;
    if (s.multipart_id) return res.status(404).end();
    const client = await getConnectedClient(s.account_id);
    const peer = buildPeer({ peer_json: s.peer_json });
    const msg = await getOne(client, peer, s.msg_id);
    await streamThumb(client, msg, res, `share-${s.id}-${s.msg_id}`);
  } catch (e) {
    if (!res.headersSent) res.status(404).end();
  }
});

// folder share: per-file raw + thumb
pubBin.get("/s/:id/file/:msgId/raw", async (req, res, next) => {
  try {
    const s = loadShareOrDeny(req, res);
    if (!s) return;
    if ((s.kind || "file") !== "folder") return res.status(400).end();
    const client = await getConnectedClient(s.account_id);
    const peer = buildPeer({ peer_json: s.peer_json });
    const msg = await getOne(client, peer, req.params.msgId);
    await streamToResponse(client, msg, req, res, { attachment: req.query.dl === "1" });
  } catch (e) {
    if (!res.headersSent) next(e);
  }
});

pubBin.get("/s/:id/file/:msgId/thumb", async (req, res, next) => {
  try {
    const s = loadShareOrDeny(req, res);
    if (!s) return;
    const client = await getConnectedClient(s.account_id);
    const peer = buildPeer({ peer_json: s.peer_json });
    const msg = await getOne(client, peer, req.params.msgId);
    await streamThumb(client, msg, res, `share-${s.id}-${req.params.msgId}`);
  } catch (e) {
    if (!res.headersSent) res.status(404).end();
  }
});

// folder share: download all as ZIP
pubBin.get("/s/:id/zip", async (req, res, next) => {
  try {
    const s = loadShareOrDeny(req, res);
    if (!s) return;
    if ((s.kind || "file") !== "folder") return res.status(400).end();
    const client = await getConnectedClient(s.account_id);
    const peer = buildPeer({ peer_json: s.peer_json });
    const r = await listMessages(client, peer, { limit: 200 });
    const zipName = safeFilename((s.name || "folder") + ".zip");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`);
    res.setHeader("Cache-Control", "no-store");
    const archive = archiver("zip", { zlib: { level: 5 } });
    archive.on("error", (e) => {
      if (!res.headersSent) next(e);
      else res.end();
    });
    archive.pipe(res);
    const used = new Set();
    for (const f of r.items) {
      try {
        const msg = await getOne(client, peer, f.id);
        const buf = await client.downloadMedia(msg);
        if (!Buffer.isBuffer(buf) || !buf.length) continue;
        let name = safeFilename(f.name || `file_${f.id}`);
        if (used.has(name)) name = `${Date.now()}-${name}`;
        used.add(name);
        archive.append(buf, { name, date: new Date((f.date || 0) * 1000) });
      } catch {}
    }
    await archive.finalize();
  } catch (e) {
    if (!res.headersSent) next(e);
  }
});
