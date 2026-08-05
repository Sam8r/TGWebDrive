import Database from "better-sqlite3";
import path from "node:path";
import { DATA_DIR } from "./config.js";
import { hashPassword, uid } from "./util.js";

const db = new Database(path.join(DATA_DIR, "tgdrive.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  phone TEXT,
  user_id TEXT,
  username TEXT,
  api_id INTEGER NOT NULL,
  api_hash TEXT NOT NULL,
  session TEXT NOT NULL,
  is_premium INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  title TEXT NOT NULL,
  peer_json TEXT NOT NULL,
  kind TEXT NOT NULL,          -- 'saved' | 'channel'
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  peer_json TEXT NOT NULL,
  msg_id INTEGER NOT NULL,
  name TEXT,
  mime TEXT,
  size INTEGER,
  password_hash TEXT,
  expires_at INTEGER,
  downloads INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL
);
`);

// migrations for evolving schema
{
  const shareCols = db.prepare("PRAGMA table_info(shares)").all().map((c) => c.name);
  if (!shareCols.includes("kind")) db.exec("ALTER TABLE shares ADD COLUMN kind TEXT NOT NULL DEFAULT 'file'");
}

export function metaGet(k, dflt = null) {
  const row = db.prepare("SELECT v FROM meta WHERE k = ?").get(k);
  return row ? row.v : dflt;
}
export function metaSet(k, v) {
  db.prepare("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, String(v));
}

export const stmt = {
  addAccount: db.prepare(`INSERT INTO accounts (id,label,phone,user_id,username,api_id,api_hash,session,is_premium,created_at,last_used_at)
    VALUES (@id,@label,@phone,@user_id,@username,@api_id,@api_hash,@session,@is_premium,@created_at,@last_used_at)`),
  listAccounts: db.prepare(`SELECT * FROM accounts ORDER BY last_used_at DESC`),
  getAccount: db.prepare(`SELECT * FROM accounts WHERE id = ?`),
  touchAccount: db.prepare(`UPDATE accounts SET last_used_at = ? WHERE id = ?`),
  updateAccount: db.prepare(`UPDATE accounts SET session=@session, is_premium=@is_premium, label=@label, user_id=@user_id, username=@username WHERE id=@id`),
  deleteAccount: db.prepare(`DELETE FROM accounts WHERE id = ?`),

  addFolder: db.prepare(`INSERT INTO folders (id,account_id,title,peer_json,kind,created_at) VALUES (@id,@account_id,@title,@peer_json,@kind,@created_at)`),
  foldersFor: db.prepare(`SELECT * FROM folders WHERE account_id = ? ORDER BY kind DESC, title COLLATE NOCASE`),
  getFolder: db.prepare(`SELECT * FROM folders WHERE id = ? AND account_id = ?`),
  deleteFolder: db.prepare(`DELETE FROM folders WHERE id = ? AND account_id = ?`),

  addShare: db.prepare(`INSERT INTO shares (id,account_id,peer_json,msg_id,name,mime,size,password_hash,expires_at,created_at,kind)
    VALUES (@id,@account_id,@peer_json,@msg_id,@name,@mime,@size,@password_hash,@expires_at,@created_at,@kind)`),
  getShare: db.prepare(`SELECT * FROM shares WHERE id = ?`),
  getShareByFile: db.prepare(`SELECT * FROM shares WHERE account_id = ? AND peer_json = ? AND msg_id = ? ORDER BY created_at DESC LIMIT 1`),
  deleteSharesByFile: db.prepare(`DELETE FROM shares WHERE account_id = ? AND peer_json = ? AND msg_id = ?`),
  deleteFolderShares: db.prepare(`DELETE FROM shares WHERE account_id = ? AND peer_json = ? AND kind = 'folder'`),
  getFolderShare: db.prepare(`SELECT * FROM shares WHERE account_id = ? AND peer_json = ? AND kind = 'folder' LIMIT 1`),
  incShareDownload: db.prepare(`UPDATE shares SET downloads = downloads + 1 WHERE id = ?`),
  listShares: db.prepare(`SELECT * FROM shares ORDER BY created_at DESC`),
  deleteShare: db.prepare(`DELETE FROM shares WHERE id = ?`),

  addApiKey: db.prepare(`INSERT INTO api_keys (id,token_hash,label,account_id,created_at) VALUES (@id,@token_hash,@label,@account_id,@created_at)`),
  listApiKeys: db.prepare(`SELECT id, label, account_id, created_at FROM api_keys ORDER BY created_at DESC`),
  findApiKeyByHash: db.prepare(`SELECT id, account_id FROM api_keys WHERE token_hash = ?`),
  deleteApiKey: db.prepare(`DELETE FROM api_keys WHERE id = ?`),

  addUser: db.prepare(`INSERT INTO users (id,username,password_hash,role,created_at) VALUES (@id,@username,@password_hash,@role,@created_at)`),
  getUserByUsername: db.prepare(`SELECT * FROM users WHERE username = ?`),
  getUserById: db.prepare(`SELECT * FROM users WHERE id = ?`),
  listUsers: db.prepare(`SELECT id, username, role, created_at FROM users ORDER BY created_at`),
  updateUser: db.prepare(`UPDATE users SET password_hash = @password_hash, role = @role WHERE id = @id`),
  deleteUser: db.prepare(`DELETE FROM users WHERE id = ?`),
  countUsers: db.prepare(`SELECT COUNT(*) AS c FROM users`),
};

// Migration: seed an admin user from the legacy single admin password (if present),
// so existing installs keep working after the upgrade to multi-user.
(() => {
  if (stmt.countUsers.get().c === 0) {
    const legacy = metaGet("admin_password");
    if (legacy) {
      stmt.addUser.run({ id: uid(), username: "admin", password_hash: legacy, role: "admin", created_at: Date.now() });
    }
  }
})();

export default db;
