import { Router } from "express";
import { stmt } from "../db.js";
import { requireAppAuth, requireAccount } from "../middleware.js";
import { getConnectedClient } from "../tg/manager.js";
import { createChannelFolder, listDialogs, SAVED_PEER } from "../tg/operations.js";
import { uid } from "../util.js";

export const folders = Router();

function ensureSaved(accountId) {
  const existing = stmt.foldersFor.all(accountId).find((f) => f.kind === "saved");
  if (existing) return existing.id;
  const id = uid();
  stmt.addFolder.run({
    id,
    account_id: accountId,
    parent_id: null,
    title: "Saved Messages",
    peer_json: JSON.stringify(SAVED_PEER),
    kind: "saved",
    created_at: Date.now(),
  });
  return id;
}

folders.get("/folders", requireAppAuth, requireAccount, (req, res) => {
  ensureSaved(req.accountId);
  const list = stmt.foldersFor.all(req.accountId).map((f) => ({
    id: f.id,
    title: f.title,
    kind: f.kind,
    isSaved: f.kind === "saved",
    parentId: f.parent_id || null,
  }));
  res.json({ folders: list });
});

folders.post("/folders", requireAppAuth, requireAccount, async (req, res, next) => {
  try {
    const title = String(req.body?.title || "").trim();
    if (!title) return res.status(400).json({ error: "Folder name required" });
    const parentId = req.body?.parentId ? String(req.body.parentId) : null;
    if (parentId) {
      const parent = stmt.getFolder.get(parentId, req.accountId);
      if (!parent) return res.status(404).json({ error: "Parent folder not found" });
    }
    const client = await getConnectedClient(req.accountId);
    const created = await createChannelFolder(client, title);
    const id = uid();
    stmt.addFolder.run({
      id,
      account_id: req.accountId,
      parent_id: parentId,
      title,
      peer_json: JSON.stringify(created.peer_json),
      kind: "channel",
      created_at: Date.now(),
    });
    res.json({ ok: true, id, title, parentId });
  } catch (e) {
    next(e);
  }
});

folders.get("/chats", requireAppAuth, requireAccount, async (req, res, next) => {
  try {
    const client = await getConnectedClient(req.accountId);
    const chats = await listDialogs(client);
    res.json({ chats });
  } catch (e) {
    next(e);
  }
});

folders.post("/folders/import", requireAppAuth, requireAccount, (req, res) => {
  const { channelId, accessHash, title } = req.body || {};
  if (!channelId || accessHash == null || !title) return res.status(400).json({ error: "channelId, accessHash, title required" });
  const id = uid();
  stmt.addFolder.run({
    id,
    account_id: req.accountId,
    parent_id: null,
    title,
    peer_json: JSON.stringify({ kind: "channel", channelId: String(channelId), accessHash: String(accessHash) }),
    kind: "channel",
    created_at: Date.now(),
  });
  res.json({ ok: true, id, title });
});

folders.delete("/folders/:id", requireAppAuth, requireAccount, (req, res) => {
  // Recursively remove descendant subfolders so nothing is orphaned.
  const all = stmt.foldersFor.all(req.accountId);
  const childrenOf = (pid) => all.filter((f) => f.parent_id === pid).map((f) => f.id);
  const stack = [req.params.id];
  const visited = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const cid of childrenOf(cur)) stack.push(cid);
  }
  for (const id of visited) stmt.deleteFolder.run(id, req.accountId);
  res.json({ ok: true });
});
