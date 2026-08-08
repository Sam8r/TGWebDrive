import { Api, utils } from "telegram";
import bigInt from "big-integer";
import fs from "node:fs";
import mime from "mime-types";
import { fmtBytes, classify, extOf } from "../util.js";
import { HttpError } from "./manager.js";
import { generateThumb, thumbCachePath } from "../thumb.js";

/* ---------- peers ---------- */

export function buildPeer(folder) {
  const p = typeof folder.peer_json === "string" ? JSON.parse(folder.peer_json) : folder.peer_json;
  if (!p) throw new HttpError(400, "Bad folder");
  if (p.kind === "self") return new Api.InputPeerSelf();
  if (p.kind === "channel") {
    return new Api.InputPeerChannel({
      channelId: BigInt(p.channelId),
      accessHash: BigInt(p.accessHash),
    });
  }
  if (p.kind === "user") {
    return new Api.InputPeerUser({ userId: BigInt(p.userId), accessHash: BigInt(p.accessHash) });
  }
  throw new HttpError(400, "Unsupported folder type");
}

export const SAVED_PEER = { kind: "self" };

/* ---------- multipart helpers ---------- */

// True for the synthetic ids we hand to the frontend (e.g. "mp_abc123").
export function isMultipartId(id) {
  return typeof id === "string" && id.startsWith("mp_");
}

// Turn a multipart_files row into the same shape produced by serializeMessage
// so the UI can treat it like any other file.
export function serializeMultipart(mp) {
  let parts = [];
  try {
    parts = JSON.parse(mp.parts_json) || [];
  } catch {}
  const mime = mp.mime || "application/octet-stream";
  return {
    id: mp.id,
    multipart: true,
    partsCount: parts.length,
    date: Math.floor(Number(mp.created_at) / 1000),
    caption: "",
    name: mp.name,
    mime,
    ext: extOf(mp.name),
    size: Number(mp.size),
    sizeText: fmtBytes(Number(mp.size)),
    kind: classify(mime, mp.name),
    isPhoto: false,
    hasThumb: false,
    width: null,
    height: null,
    duration: null,
  };
}

export function parseParts(mp) {
  try {
    return JSON.parse(mp.parts_json) || [];
  } catch {
    return [];
  }
}

/* ---------- message serialization ---------- */

function docName(doc) {
  for (const a of doc?.attributes || []) {
    if (a instanceof Api.DocumentAttributeFilename) return a.fileName;
  }
  const ext = utils.getExtension(doc) || extOf("");
  return "file" + (ext ? "." + ext : "");
}

export function serializeMessage(msg) {
  if (!msg || !msg.media || msg.media instanceof Api.MessageMediaEmpty || msg.media instanceof Api.MessageMediaWebPage) {
    return null;
  }
  let name = null,
    mime = null,
    size = null,
    isPhoto = false,
    hasThumb = false,
    width = null,
    height = null,
    duration = null;

  if (msg.media instanceof Api.MessageMediaPhoto && msg.media.photo && !(msg.media.photo instanceof Api.PhotoEmpty)) {
    isPhoto = true;
    mime = "image/jpeg";
    name = `photo_${msg.id}.jpg`;
    hasThumb = true;
    let best = 0;
    let dim = null;
    for (const s of msg.media.photo.sizes || []) {
      const t = s instanceof Api.PhotoSizeProgressive ? Math.max(...(s.sizes || [])) : s.size || 0;
      if (t > best) {
        best = Number(t);
        if (s.w && s.h) dim = { w: s.w, h: s.h };
      }
      if ((s instanceof Api.PhotoStrippedSize || s instanceof Api.PhotoCachedSize) && !hasThumb) hasThumb = true;
    }
    size = best || null;
    if (dim) {
      width = dim.w;
      height = dim.h;
    }
  } else if (msg.media instanceof Api.MessageMediaDocument && msg.media.document && !(msg.media.document instanceof Api.DocumentEmpty)) {
    const doc = msg.media.document;
    mime = doc.mimeType || "application/octet-stream";
    size = Number(doc.size);
    name = docName(doc);
    for (const a of doc.attributes || []) {
      if (a instanceof Api.DocumentAttributeImageSize) {
        width = a.w;
        height = a.h;
      }
      if (a instanceof Api.DocumentAttributeVideo) {
        width = a.w ?? width;
        height = a.h ?? height;
        duration = a.duration ?? duration;
        if (!hasThumb && (a.thumb || a.flags?.thumb)) hasThumb = true;
      }
      if (a instanceof Api.DocumentAttributeAnimated) hasThumb = hasThumb || !!doc.thumbs?.length;
    }
    hasThumb = hasThumb || !!(doc.thumbs && doc.thumbs.length);
  } else {
    return null;
  }

  return {
    id: Number(msg.id),
    date: Number(msg.date),
    caption: msg.message || "",
    name,
    mime: mime || "application/octet-stream",
    ext: extOf(name),
    size,
    sizeText: fmtBytes(size),
    kind: classify(mime, name),
    isPhoto,
    hasThumb,
    width,
    height,
    duration,
  };
}

/* ---------- listing ---------- */

export async function listMessages(client, peer, { limit = 50, offsetId = 0, search } = {}) {
  const params = {
    limit,
    offsetId: Number(offsetId) || 0,
  };
  if (search) params.search = search;
  const messages = await client.getMessages(peer, params);
  const items = [];
  for (const m of messages) {
    const s = serializeMessage(m);
    if (s) items.push(s);
  }
  const last = messages.length ? Number(messages[messages.length - 1].id) : null;
  return { items, nextOffset: last && messages.length >= limit ? last : null, count: items.length };
}

export async function getOne(client, peer, id) {
  const messages = await client.getMessages(peer, { ids: [Number(id)] });
  const msg = Array.isArray(messages) ? messages[0] : messages;
  if (!msg) throw new HttpError(404, "File not found");
  return msg;
}

/* ---------- upload ---------- */

export function uploadFile(client, peer, { filePath, fileName, fileSize, caption, forceDocument, onProgress, thumb }) {
  return client.sendFile(peer, {
    file: filePath,
    fileName,
    fileSize,
    caption: caption || "",
    forceDocument: !!forceDocument,
    supportsStreaming: true,
    thumb,
    progressCallback: onProgress,
  });
}

/* ---------- rename (caption) / delete ---------- */

export function renameFile(client, peer, id, caption) {
  return client.editMessage(peer, { message: Number(id), text: caption || "" });
}

export async function deleteFiles(client, peer, ids) {
  const numIds = ids.map((x) => Number(x));
  try {
    await client.deleteMessages(peer, numIds, { revoke: true });
    return true;
  } catch (e) {
    // channels may need a different route
    if (peer instanceof Api.InputPeerChannel) {
      await client.invoke(
        new Api.channels.DeleteMessages({
          channel: new Api.InputChannel({ channelId: peer.channelId, accessHash: peer.accessHash }),
          id: numIds,
        })
      );
      return true;
    }
    throw e;
  }
}

/* ---------- download / stream ---------- */

export async function streamToResponse(client, msg, req, res, { attachment = false, name, mime: forcedMime } = {}) {
  const meta = serializeMessage(msg) || {};
  const contentType = forcedMime || meta.mime || "application/octet-stream";
  const fileName = meta.name || name || "file";
  const total = Number(meta.size) || 0;
  const rangeHeader = req?.headers?.range;

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=3600");

  // Forced download, or unknown size → stream the whole file without range handling.
  if (attachment || !total) {
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `${attachment ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return streamFull(client, msg, req, res, total);
  }

  // Inline playback with a known size → honour Range requests so video/audio can seek.
  let start = 0;
  let end = total - 1;
  let ranged = false;
  if (rangeHeader) {
    const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (m) {
      if (m[1]) start = parseInt(m[1], 10);
      else if (m[2]) start = Math.max(0, total - parseInt(m[2], 10)); // suffix range (last N bytes)
      if (m[1] && m[2]) end = parseInt(m[2], 10);
      if (start > total - 1) start = total - 1;
      end = Math.min(end, total - 1);
      ranged = true;
    }
  }
  const length = end - start + 1;
  res.writeHead(ranged ? 206 : 200, {
    "Content-Type": contentType,
    "Content-Length": String(length),
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    ...(ranged ? { "Content-Range": `bytes ${start}-${end}/${total}` } : {}),
  });
  return streamRange(client, msg, req, res, start, length, total);
}

// Full progressive stream via the high-level downloadMedia writer.
async function streamFull(client, msg, req, res, total) {
  if (total) res.setHeader("Content-Length", String(total));
  let aborted = false;
  const onAbort = () => (aborted = true);
  if (req) req.on("close", onAbort);
  const writer = {
    async write(chunk) {
      if (aborted || res.destroyed) throw new Error("aborted");
      if (!res.write(chunk)) await new Promise((r) => res.once("drain", r));
    },
    async close() {
      if (!res.destroyed && !res.writableEnded) res.end();
    },
  };
  try {
    await client.downloadMedia(msg, { outputFile: writer });
  } catch (e) {
    if (!res.headersSent) throw e;
    try { res.end(); } catch {}
  } finally {
    if (req) req.removeListener("close", onAbort);
  }
}

// Stream only the requested byte range directly from Telegram (no temp file),
// enabling fast seeking for large videos.
async function streamRange(client, msg, req, res, start, length, total) {
  let aborted = false;
  const onAbort = () => (aborted = true);
  if (req) req.on("close", onAbort);
  let sent = 0;
  try {
    for await (const chunk of client.iterDownload({
      file: msg.media,
      offset: bigInt(start),
      fileSize: bigInt(total),
      requestSize: 524288,
    })) {
      if (aborted || res.destroyed) break;
      let out = chunk;
      const remaining = length - sent;
      if (out.length > remaining) out = out.subarray(0, remaining);
      if (out.length) {
        if (!res.write(out)) await new Promise((r) => res.once("drain", r));
        sent += out.length;
      }
      if (sent >= length) break;
    }
  } catch (e) {
    if (!res.headersSent) throw e;
    try { res.end(); } catch {}
  } finally {
    if (req) req.removeListener("close", onAbort);
    if (!res.destroyed && !res.writableEnded) res.end();
  }
}

// Stream a multipart (split) file as one continuous download: each Telegram
// part is fetched in order and piped straight to the client. Range requests
// are not supported across parts, so callers force a full stream.
export async function streamMultipart(client, peer, parts, total, req, res, { attachment = false, name, mime } = {}) {
  const contentType = mime || "application/octet-stream";
  const fileName = name || "file";

  // Fetch every part message up front so we can pipe them back to back.
  const ids = parts.map((p) => Number(p.msgId)).filter((x) => !isNaN(x));
  let messages = [];
  if (ids.length) messages = await client.getMessages(peer, { ids });

  res.setHeader("Accept-Ranges", "none");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `${attachment ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  if (total) res.setHeader("Content-Length", String(total));
  res.writeHead(200);

  let aborted = false;
  const onAbort = () => (aborted = true);
  if (req) req.on("close", onAbort);

  try {
    for (let i = 0; i < messages.length; i++) {
      if (aborted || res.destroyed) break;
      const msg = Array.isArray(messages) ? messages[i] : messages;
      if (!msg) continue;
      const writer = {
        async write(chunk) {
          if (aborted || res.destroyed) throw new Error("aborted");
          if (!res.write(chunk)) await new Promise((r) => res.once("drain", r));
        },
        async close() {},
      };
      await client.downloadMedia(msg, { outputFile: writer });
    }
  } catch (e) {
    if (!res.headersSent) throw e;
    try { res.end(); } catch {}
  } finally {
    if (req) req.removeListener("close", onAbort);
    if (!res.destroyed && !res.writableEnded) res.end();
  }
}

/* ---------- thumbnail ---------- */

export async function streamThumb(client, msg, res, cacheKey) {
  // 1. native Telegram thumbnail
  const tmp = `/tmp/tgd-thumb-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  try {
    await client.downloadMedia(msg, { outputFile: tmp, thumb: 0 });
    if (fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
      const data = fs.readFileSync(tmp);
      fs.unlink(tmp, () => {});
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=604800");
      return res.send(data);
    }
  } catch {}
  if (fs.existsSync(tmp)) fs.unlink(tmp, () => {});

  // 2. no native thumb — generate one from the full image (images only)
  const meta = serializeMessage(msg);
  const isImg = meta.kind === "image" || (meta.mime && meta.mime.startsWith("image/"));
  if (isImg && cacheKey) {
    const cachePath = thumbCachePath(cacheKey);
    try {
      if (!fs.existsSync(cachePath)) {
        const buf = await client.downloadMedia(msg);
        if (!Buffer.isBuffer(buf) || !buf.length) throw new Error("no data");
        const thumb = await generateThumb(buf);
        fs.writeFileSync(cachePath, thumb);
      }
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=604800");
      return res.sendFile(cachePath);
    } catch {}
  }
  res.status(404).end();
}

/* ---------- folders / channels ---------- */

export async function createChannelFolder(client, title) {
  const res = await client.invoke(
    new Api.channels.CreateChannel({
      broadcast: true,
      title: title.slice(0, 255),
      about: "Telegram Drive folder",
    })
  );
  const chat = extractCreatedChat(res);
  if (!chat) throw new HttpError(500, "Could not create folder");
  return {
    title,
    peer_json: {
      kind: "channel",
      channelId: String(chat.id),
      accessHash: String(chat.accessHash),
    },
  };
}

function extractCreatedChat(updates) {
  const chats = updates?.chats || updates?.updates?.flatMap?.((u) => u?.chats || []) || [];
  for (const c of chats) {
    if (c instanceof Api.Channel) return c;
  }
  return chats[0] || null;
}

export async function listDialogs(client) {
  const res = await client.invoke(new Api.messages.GetDialogs({ offsetPeer: new Api.InputPeerEmpty(), limit: 100, hash: 0n }));
  const out = [];
  const chats = res.chats || [];
  for (const c of chats) {
    if (c instanceof Api.Channel) {
      out.push({ id: String(c.id), accessHash: String(c.accessHash), title: c.title || "Channel", type: "channel", username: c.username || null });
    } else if (c instanceof Api.Chat) {
      out.push({ id: String(c.id), accessHash: "0", title: c.title || "Chat", type: "chat", username: null });
    }
  }
  return out;
}
