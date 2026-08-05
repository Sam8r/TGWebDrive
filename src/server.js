import express from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { config, PUBLIC_DIR } from "./config.js";
import { HttpError } from "./tg/manager.js";
import { auth } from "./routes/auth.js";
import { folders } from "./routes/folders.js";
import { files } from "./routes/files.js";
import { share, pubBin } from "./routes/share.js";
import { stats } from "./routes/stats.js";
import { api, keys } from "./routes/api.js";
import { branding } from "./routes/branding.js";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser(config.secret));

// security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use("/api", auth, folders, files, share, stats, api, keys, branding);

// public share binary streams (raw / thumb / zip) — must be before SPA fallback
app.use(pubBin);

// static frontend
const indexFile = path.join(PUBLIC_DIR, "index.html");
app.use(express.static(PUBLIC_DIR, { maxAge: 0, etag: true, index: false }));

// SPA fallback: any non-API GET serves index.html (never cached)
app.get(/^\/(?!api\/).*/, (req, res, next) => {
  if (req.method !== "GET") return next();
  if (fs.existsSync(indexFile)) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.sendFile(indexFile);
  }
  res.status(404).send("Not found");
});

// error handler
app.use((err, req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  console.error("[error]", err?.stack || err);
  res.status(500).json({ error: err?.message || "Internal error" });
});

app.listen(config.port, config.host, () => {
  console.log(`tgdrive listening on http://${config.host}:${config.port} (proxied via Apache)`);
});

process.on("uncaughtException", (e) => console.error("[uncaught]", e?.stack || e));
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e?.stack || e));
