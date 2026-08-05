import { Router } from "express";
import fs from "node:fs";
import { stmt } from "../db.js";
import { requireAppAuth, requireAccount } from "../middleware.js";
import { getConnectedClient, HttpError } from "../tg/manager.js";
import {
  buildPeer,
  listMessages,
  getOne,
  serializeMessage,
  uploadFile,
  renameFile,
  deleteFiles,
  streamToResponse,
  streamThumb,
} from "../tg/operations.js";
import { publish, subscribe, finish, fail } from "../jobs.js";
import { tempPath, safeFilename } from "../util.js";
import { generateThumb, IMAGE_RE } from "../thumb.js";

export const files = Router();

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
    const { peer } = await loadFolder(req);
    const client = await getConnectedClient(req.accountId);
    const r = await listMessages(client, peer, {
      limit: Math.min(Number(req.query.limit) || 60, 200),
      offsetId: req.query.offsetId || 0,
      search: req.query.search || undefined,
    });
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
    const { peer } = await loadFolder(req);
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
    if (job) fail(job, e);
    next(e);
  }
});

/* --------- single + raw + thumb --------- */
files.get("/files/:id", requireAppAuth, requireAccount, async (req, res, next) => {
  try {
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
    await deleteFiles(client, peer, ids);
    res.json({ ok: true, deleted: ids.length });
  } catch (e) {
    next(e);
  }
});
