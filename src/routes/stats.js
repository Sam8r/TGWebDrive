import { Router } from "express";
import { stmt } from "../db.js";
import { requireAppAuth, requireAccount } from "../middleware.js";
import { getConnectedClient } from "../tg/manager.js";
import { buildPeer, serializeMessage } from "../tg/operations.js";
import { fmtBytes } from "../util.js";

export const stats = Router();

stats.get("/stats", requireAppAuth, requireAccount, async (req, res, next) => {
  try {
    const folderIds = [];
    const q = req.query.folder;
    if (q) folderIds.push(q);
    else folderIds.push(...stmt.foldersFor.all(req.accountId).map((f) => f.id));

    let count = 0;
    let totalBytes = 0;
    const byKind = {};
    const folders = [];

    for (const fid of folderIds.slice(0, 5)) {
      const row = stmt.getFolder.get(fid, req.accountId);
      if (!row) continue;
      const client = await getConnectedClient(req.accountId);
      const peer = buildPeer(row);
      let offsetId = 0;
      let fCount = 0;
      let fBytes = 0;
      // sample up to ~500 recent messages per folder
      for (let i = 0; i < 10; i++) {
        const messages = await client.getMessages(peer, { limit: 50, offsetId });
        if (!messages.length) break;
        for (const m of messages) {
          const s = serializeMessage(m);
          if (!s) continue;
          fCount++;
          fBytes += s.size || 0;
          count++;
          totalBytes += s.size || 0;
          byKind[s.kind] = (byKind[s.kind] || 0) + 1;
        }
        offsetId = Number(messages[messages.length - 1].id);
        if (messages.length < 50) break;
      }
      folders.push({ id: fid, title: row.title, count: fCount, bytes: fBytes, bytesText: fmtBytes(fBytes) });
    }

    res.json({
      approximate: true,
      count,
      totalBytes,
      totalText: fmtBytes(totalBytes),
      byKind,
      folders,
    });
  } catch (e) {
    next(e);
  }
});
