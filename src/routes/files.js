import { Router } from "express";
import fs from "node:fs";
import mime from "mime-types";
import { stmt } from "../db.js";
import { config } from "../config.js";
import { requireAppAuth, requireAccount } from "../middleware.js";
import { getConnectedClient, HttpError } from "../tg/manager.js";
import {
  buildPeer,
  listMessages,
  getOne,
  serializeMessage,
  serializeMultipart,
  parseParts,
  isMultipartId,
  uploadFile,
  renameFile,
  deleteFiles,
  streamToResponse,
  streamMultipart,
  streamThumb,
} from "../tg/operations.js";
import { publish, subscribe, finish, fail } from "../jobs.js";
import { uid, safeFilename } from "../util.js";
import { generateThumb, IMAGE_RE } from "../thumb.js";

export const files = Router();

// Copy a byte range of src into dst (used to carve <=2 GiB parts on disk).
function sliceToFile(src, start, size, dst) {
  return new Promise((resolve, reject) => {
    const r = fs.createReadStream(src, { start, end: start + size - 1 });
    const w = fs.createWriteStream(dst);
    let done = false;
    const finishOnce = (err) => {
      if (done) return;
      done = true;
      err ? reject(err) : resolve();
    };
    r.on("error", finishOnce);
    w.on("error", finishOnce);
    w.on("finish", () => finishOnce());
    r.pipe(w);
  });
}

// Load a multipart row owned by this account or 404.
function loadOwnedMultipart(req) {
  const mp = stmt.getMultipart.get(req.params.id);
  if (!mp || mp.account_id !== req.accountId) throw new HttpError(404, "File not found");
  return mp;
}

async function loadFolder(req) {
  const folderId = req.query.folder || req.headers["x-folder"];
  if (!folderId) throw new HttpError(400, "Missing folder");
  const row = stmt.getFolder.get(folderId, req.accountId);
  if (!row) throw new HttpError(404, "Folder not found");
  return { row, peer: buildPeer(row) };
}

/* --------- list --------- */
files.get("/files", requireAppAuth, requireAccount, async (req, res, next) => {
  try {
    const { row, peer } = await loadFolder(req);
    const client = await getConnectedClient(req.accountId);
    const r = await listMessages(client, peer, {
      limit: Math.min(Number(req.query.limit) || 60, 200),
      offsetId: req.query.offsetId || 0,
      search: req.query.search || undefined,
    });

    // Merge multipart (split) files: always hide their underlying parts, and on
    // the first page also surface one virtual entry per logical file.
    const mps = stmt.listMultipart.all(req.accountId, row.peer_json);
    if (mps.length) {
      const partIds = new Set();
      for (const mp of mps) for (const p of parseParts(mp)) partIds.add(Number(p.msgId));
      if (partIds.size) r.items = r.items.filter((it) => !partIds.has(Number(it.id)));
      if (!req.query.offsetId) {
        const search = (req.query.search || "").toLowerCase();
        for (const mp of mps) {
          if (search && !(mp.name || "").toLowerCase().includes(search)) continue;
          r.items.push(serializeMultipart(mp));
        }
        r.items.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));
      }
      r.count = r.items.length;
    }
    res.json(r);
  } catch (e) {
    next(e);
  }
});

/* --------- upload progress (SSE) --------- */
files.get("/files/upload/progress", requireAppAuth, (req, res) => {
  const job = String(req.query.job || "");
  if (!job) return res.status(400).end();
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write(":ok\n\n");
  const send = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);
  const unsubscribe = subscribe(job, send);
  const keep = setInterval(() => {
    try {
      res.write(":ping\n\n");
    } catch {}
  }, 20000);
  req.on("close", () => {
    clearInterval(keep);
    unsubscribe();
  });
});

/* --------- upload --------- */
files.post("/files/upload", requireAppAuth, requireAccount, async (req, res, next) => {
  const job = String(req.headers["x-job"] || "");
  let tmp = "";
  let upDir = "";
  try {
    const { row, peer } = await loadFolder(req);
    const client = await getConnectedClient(req.accountId);
    const fileName = safeFilename(decodeURIComponent(req.headers["x-filename"] || "file"));
    const size = Number(req.headers["x-filesize"] || 0);
    const caption = req.headers["x-caption"] ? decodeURIComponent(req.headers["x-caption"]) : "";
    const forceDocument = req.headers["x-force-document"] !== "0";

    upDir = fs.mkdtempSync("/tmp/tgd-up-");
    tmp = `${upDir}/${fileName}`;
    const out = fs.createWriteStream(tmp);
    let received = 0;
    await new Promise((resolve, reject) => {
      const onData = (c) => {
        received += c.length;
        if (job && size) publish(job, { phase: "receiving", received, size, ratio: received / size });
      };
      req.on("data", onData);
      req.pipe(out);
      out.on("finish", () => resolve());
      out.on("error", reject);
      req.on("error", reject);
      req.on("aborted", () => reject(new Error("Client aborted upload")));
    });

    if (job) publish(job, { phase: "sending", uploaded: 0, total: size, ratio: 0 });
    let thumbPath;
    if (IMAGE_RE.test(fileName)) {
      try {
        thumbPath = `${upDir}/_thumb.jpg`;
        await generateThumb(tmp, thumbPath);
      } catch {
        thumbPath = undefined;
      }
    }

    // Large files are transparently split into <=2 GiB Telegram parts that
    // reassemble on download; everything else uploads as a single message.
    if (size > config.splitPartBytes) {
      const detectedMime = mime.lookup(fileName) || "application/octet-stream";
      // Create the grouping record BEFORE uploading so the parts are tracked
      // (and hidden from the file list) from the very first one — split parts
      // must never appear as separate files, even if the upload is interrupted.
      const mpId = "mp_" + uid();
      stmt.addMultipart.run({
        id: mpId,
        account_id: req.accountId,
        peer_json: row.peer_json,
        name: fileName,
        mime: detectedMime,
        size,
        parts_json: "[]",
        created_at: Date.now(),
      });
      const parts = [];
      let offset = 0;
      let partIndex = 0;
      let uploadedSoFar = 0;
      try {
        while (offset < size) {
          const thisSize = Math.min(config.splitPartBytes, size - offset);
          // Name the temp part after the real file so Telegram stores it under a
          // recognisable name (not the temp basename "_part0").
          const partName = `${fileName}.part${partIndex}`.replace(/[\\/]/g, "_");
          const partPath = `${upDir}/${partName}`;
          await sliceToFile(tmp, offset, thisSize, partPath);
          const sent = await uploadFile(client, peer, {
            filePath: partPath,
            fileName: partName,
            fileSize: thisSize,
            caption: partIndex === 0 ? caption : "",
            forceDocument: true,
            onProgress: (uploaded) => {
              if (!job) return;
              const overall = uploadedSoFar + Number(uploaded);
              publish(job, {
                phase: "sending",
                uploaded: String(overall),
                total: String(size),
                ratio: size ? overall / size : 0,
                multipart: true,
                part: partIndex + 1,
              });
            },
          });
          fs.unlink(partPath, () => {});
          const msgId = Number(sent && sent.id);
          if (!msgId || Number.isNaN(msgId)) throw new Error("Telegram returned no id for part " + (partIndex + 1));
          parts.push({ msgId, size: thisSize });
          // Persist each part as it lands, so the record always matches what's
          // safely in Telegram (and the list hides those messages immediately).
          stmt.updateMultipartParts.run({ id: mpId, parts_json: JSON.stringify(parts) });
          uploadedSoFar += thisSize;
          offset += thisSize;
          partIndex++;
        }
      } catch (splitErr) {
        // Roll back everything so the file list never shows half-uploaded parts.
        const sentIds = parts.map((p) => p.msgId).filter(Boolean);
        if (sentIds.length) {
          try { await deleteFiles(client, peer, sentIds); } catch {}
        }
        stmt.deleteMultipart.run(mpId);
        stmt.deleteSharesByMultipart.run(mpId);
        throw splitErr;
      }
      fs.rm(upDir, { recursive: true, force: true }, () => {});
      const file = serializeMultipart(stmt.getMultipart.get(mpId));
      if (job) finish(job, { id: file?.id, name: file?.name });
      return res.json({ ok: true, file });
    }

    const sent = await uploadFile(client, peer, {
      filePath: tmp,
      fileName,
      fileSize: size || undefined,
      caption,
      forceDocument,
      thumb: thumbPath,
      onProgress: (uploaded, total) => {
        if (!job) return;
        publish(job, {
          phase: "sending",
          uploaded: String(uploaded),
          total: String(total),
          ratio: total ? Number(uploaded) / Number(total) : 0,
        });
      },
    });
    fs.rm(upDir, { recursive: true, force: true }, () => {});
    const file = serializeMessage(sent);
    if (job) finish(job, { id: file?.id, name: file?.name });
    res.json({ ok: true, file });
  } catch (e) {
    if (upDir) fs.rm(upDir, { recursive: true, force: true }, () => {});
    const aborted = e?.message === "Client aborted upload" || e?.code === "ERR_ABORTED";
    if (job) fail(job, aborted ? new Error("Cancelled") : e);
    if (aborted) return res.status(499).end(); // client went away — don't log a 500
    next(e);
  }
});

/* --------- single + raw + thumb --------- */
files.get("/files/:id", requireAppAuth, requireAccount, async (req, res, next) => {
  try {
    if (isMultipartId(req.params.id)) {
      return res.json({ file: serializeMultipart(loadOwnedMultipart(req)) });
    }
    const { peer } = await loadFolder(req);
    const client = await getConnectedClient(req.accountId);
    const msg = await getOne(client, peer, req.params.id);
    res.json({ file: serializeMessage(msg) });
  } catch (e) {
    next(e);
  }
});

files.get("/files/:id/raw", requireAppAuth, requireAccount, async (req, res, next) => {
  try {
    if (isMultipartId(req.params.id)) {
      const mp = loadOwnedMultipart(req);
      const client = await getConnectedClient(req.accountId);
      const peer = buildPeer({ peer_json: mp.peer_json });
      return await streamMultipart(client, peer, parseParts(mp), Number(mp.size), req, res, {
        attachment: false,
        name: mp.name,
        mime: mp.mime,
      });
    }
    const { peer } = await loadFolder(req);
    const client = await getConnectedClient(req.accountId);
    const msg = await getOne(client, peer, req.params.id);
    await streamToResponse(client, msg, req, res, { attachment: false });
  } catch (e) {
    if (!res.headersSent) next(e);
  }
});

files.get("/files/:id/download", requireAppAuth, requireAccount, async (req, res, next) => {
  try {
    if (isMultipartId(req.params.id)) {
      const mp = loadOwnedMultipart(req);
      const client = await getConnectedClient(req.accountId);
      const peer = buildPeer({ peer_json: mp.peer_json });
      return await streamMultipart(client, peer, parseParts(mp), Number(mp.size), req, res, {
        attachment: true,
        name: mp.name,
        mime: mp.mime,
      });
    }
    const { peer } = await loadFolder(req);
    const client = await getConnectedClient(req.accountId);
    const msg = await getOne(client, peer, req.params.id);
    await streamToResponse(client, msg, req, res, { attachment: true });
  } catch (e) {
    if (!res.headersSent) next(e);
  }
});

files.get("/files/:id/thumb", requireAppAuth, requireAccount, async (req, res, next) => {
  try {
    if (isMultipartId(req.params.id)) return res.status(404).end();
    const { peer } = await loadFolder(req);
    const client = await getConnectedClient(req.accountId);
    const msg = await getOne(client, peer, req.params.id);
    await streamThumb(client, msg, res, `${req.accountId}-${req.query.folder}-${req.params.id}`);
  } catch (e) {
    if (!res.headersSent) res.status(404).end();
  }
});

/* --------- rename (caption) --------- */
files.patch("/files/:id", requireAppAuth, requireAccount, async (req, res, next) => {
  try {
    if (isMultipartId(req.params.id)) {
      const mp = loadOwnedMultipart(req);
      const name = String(req.body?.name ?? req.body?.caption ?? (mp.name || "")).trim();
      if (name) stmt.renameMultipart.run({ id: req.params.id, name: safeFilename(name) || mp.name });
      return res.json({ ok: true });
    }
    const { peer } = await loadFolder(req);
    const client = await getConnectedClient(req.accountId);
    await renameFile(client, peer, req.params.id, String(req.body?.caption ?? ""));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* --------- delete --------- */
files.delete("/files", requireAppAuth, requireAccount, async (req, res, next) => {
  try {
    const { peer } = await loadFolder(req);
    const client = await getConnectedClient(req.accountId);
    let ids = req.query.ids || req.body?.ids;
    if (typeof ids === "string") ids = ids.split(",").map((x) => x.trim());
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "ids required" });

    const mpIds = ids.filter((x) => isMultipartId(x));
    const msgIds = ids.filter((x) => !isMultipartId(x));
    let deleted = 0;

    if (msgIds.length) {
      await deleteFiles(client, peer, msgIds);
      deleted += msgIds.length;
    }

    for (const mpId of mpIds) {
      const mp = stmt.getMultipart.get(mpId);
      if (!mp || mp.account_id !== req.accountId) continue;
      const partIds = parseParts(mp).map((p) => p.msgId).filter(Boolean);
      if (partIds.length) {
        try {
          await deleteFiles(client, peer, partIds);
        } catch {}
      }
      stmt.deleteMultipart.run(mpId);
      stmt.deleteSharesByMultipart.run(mpId);
      deleted++;
    }

    res.json({ ok: true, deleted });
  } catch (e) {
    next(e);
  }
});
