// In-memory pub/sub for upload progress (single process).
const subs = new Map(); // jobId -> Set<fn>

export function subscribe(jobId, fn) {
  if (!subs.has(jobId)) subs.set(jobId, new Set());
  subs.get(jobId).add(fn);
  return () => {
    const s = subs.get(jobId);
    if (s) s.delete(fn);
  };
}
export function publish(jobId, data) {
  const s = subs.get(jobId);
  if (!s) return;
  for (const fn of [...s]) {
    try {
      fn(data);
    } catch {}
  }
}
export function finish(jobId, payload = {}) {
  publish(jobId, { ...payload, done: true });
  subs.delete(jobId);
}
export function fail(jobId, error) {
  publish(jobId, { error: String(error?.message || error) });
  subs.delete(jobId);
}
