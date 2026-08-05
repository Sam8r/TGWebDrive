import "dotenv/config";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(ROOT, "data");
export const PUBLIC_DIR = path.join(ROOT, "public");
export const UPLOAD_TMP = path.join(DATA_DIR, "uploads");

for (const d of [DATA_DIR, UPLOAD_TMP]) fs.mkdirSync(d, { recursive: true });

function readSecret() {
  const envFile = path.join(ROOT, ".env");
  if (process.env.SECRET && process.env.SECRET.length >= 32) return process.env.SECRET;
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^SECRET=(.+)$/);
      if (m && m[1].trim().length >= 32) return m[1].trim();
    }
  }
  const generated = randomBytes(32).toString("hex");
  const extra = process.env.SECRET ? `\n` : `\n`;
  const block = `SECRET=${generated}\n`;
  if (fs.existsSync(envFile)) {
    let txt = fs.readFileSync(envFile, "utf8");
    if (/^SECRET=/.test(txt)) txt = txt.replace(/^SECRET=.*$/m, `SECRET=${generated}`);
    else txt = txt.replace(/\s*$/, "") + "\n" + block;
    fs.writeFileSync(envFile, txt);
  } else {
    fs.writeFileSync(envFile, block);
  }
  process.env.SECRET = generated;
  return generated;
}

export const config = {
  port: Number(process.env.PORT) || 3001,
  host: process.env.HOST || "127.0.0.1",
  secret: readSecret(),
  publicUrl: (process.env.PUBLIC_URL || "").replace(/\/$/, ""),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES) || 2 * 1024 * 1024 * 1024,
  apiPresets: (process.env.API_PRESETS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [id, hash] = s.split(":");
      return { id: id.trim(), hash: hash.trim() };
    }),
  isProd: process.env.NODE_ENV === "production",
};
