import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";
import path from "node:path";

export function uid() {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

export function shortId(n = 8) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function hashPassword(plain) {
  if (!plain) return null;
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 32);
  return "scrypt$" + salt.toString("hex") + "$" + hash.toString("hex");
}

export function verifyPassword(plain, stored) {
  if (!stored) return !plain;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const hash = Buffer.from(parts[2], "hex");
  const test = scryptSync(plain || "", salt, 32);
  return hash.length === test.length && timingSafeEqual(hash, test);
}

export function token(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];
export function fmtBytes(n) {
  if (n == null || isNaN(n)) return "—";
  n = Number(n);
  if (n < 1) return n + " B";
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), UNITS.length - 1);
  return (n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + " " + UNITS[i];
}

export function fmtRate(bytesPerSec) {
  return fmtBytes(bytesPerSec) + "/s";
}

export function safeFilename(name) {
  return (name || "file")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || "file";
}

export function tempPath(prefix = "up") {
  return path.join("/tmp", `${prefix}-${Date.now()}-${shortId(6)}`);
}

export function isImage(mime) {
  return typeof mime === "string" && mime.startsWith("image/");
}
export function isVideo(mime) {
  return typeof mime === "string" && (mime.startsWith("video/") || mime === "application/x-mpegurl");
}
export function isAudio(mime) {
  return typeof mime === "string" && (mime.startsWith("audio/") || mime === "application/ogg");
}

export function classify(mime, name) {
  const n = (name || "").toLowerCase();
  if (isImage(mime)) return "image";
  if (isVideo(mime)) return "video";
  if (isAudio(mime)) return "audio";
  if (mime === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (/\.(zip|rar|7z|tar|gz|bz2|xz)$/.test(n)) return "archive";
  if (/\.(txt|md|json|js|ts|css|html|xml|yaml|yml|csv|log|ini|conf|sh|py|rs|go|java|c|cpp|h)$/.test(n)) return "text";
  return "file";
}

export function extOf(name) {
  const m = (name || "").match(/\.([a-z0-9]{1,8})$/i);
  return m ? m[1].toLowerCase() : "";
}
