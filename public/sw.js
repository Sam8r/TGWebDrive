// Background upload service worker.
// The page hands off each upload (File + request details) via postMessage; this
// worker performs the actual POST. Because the fetch lives in the worker (not
// the page), it keeps running when the user navigates within the app or away —
// so large/slow uploads are no longer killed by navigation.
const jobs = new Map(); // uploadId -> job
const aborts = new Map(); // uploadId -> AbortController

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "upload") return handleUpload(d);
  if (d.type === "abort") return abortJob(d.id);
  if (d.type === "sync") return sendAll(e.source);
});

async function handleUpload({ id, url, file, headers, name, folderId, size, jobId }) {
  if (jobs.has(id)) return;
  jobs.set(id, { id, name: name || "file", folderId, size: size || 0, jobId, status: "uploading" });
  broadcast(id);
  const ac = new AbortController();
  aborts.set(id, ac);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: file,
      credentials: "include",
      duplex: "half",
      signal: ac.signal,
    });
    const text = await res.text();
    let fileMeta = null;
    let errMsg = null;
    try {
      const j = JSON.parse(text);
      fileMeta = j.file || null;
      errMsg = j.error || null;
    } catch {}
    jobs.set(id, {
      ...jobs.get(id),
      status: res.ok ? "done" : "error",
      error: res.ok ? null : errMsg || `Upload failed (${res.status})`,
      file: fileMeta,
    });
  } catch (err) {
    const aborted = err?.name === "AbortError";
    jobs.set(id, { ...jobs.get(id), status: aborted ? "aborted" : "error", error: aborted ? "Cancelled" : err?.message || "Network error" });
  }
  aborts.delete(id);
  broadcast(id);
  prune();
}

function abortJob(id) {
  const ac = aborts.get(id);
  if (ac) try { ac.abort(); } catch {}
}

function prune() {
  if (jobs.size <= 40) return;
  const finished = [...jobs.values()].filter((j) => j.status !== "uploading");
  for (const j of finished.slice(0, finished.length - 20)) jobs.delete(j.id);
}

async function broadcast(id) {
  const j = jobs.get(id);
  if (!j) return;
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of clients) c.postMessage({ type: "upload-status", job: j });
}

async function sendAll(client) {
  if (!client) return;
  for (const j of jobs.values()) client.postMessage({ type: "upload-status", job: j });
}
