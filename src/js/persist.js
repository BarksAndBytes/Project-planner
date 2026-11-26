// Persistence. In the installed app this calls the Rust core
// (src-tauri/src/storage.rs). In a plain browser during development it
// falls back to localStorage so the screens can be worked on without a
// Tauri build. The fallback never runs in a release build, because the
// Tauri runtime is always present there.

const DEV_KEY = "work-dashboard-dev";
const DEVICE_KEY = "work-dashboard-device-id";

function tauri() {
  return globalThis.__TAURI__?.core;
}

export const isNative = () => Boolean(tauri());

export async function loadRaw() {
  const t = tauri();
  if (t) return (await t.invoke("load_data")) ?? null;
  try { return localStorage.getItem(DEV_KEY); } catch { return null; }
}

export async function saveRaw(json) {
  const t = tauri();
  if (t) return t.invoke("save_data", { json });
  try { localStorage.setItem(DEV_KEY, json); } catch { /* storage unavailable */ }
}

export async function getDeviceId() {
  const t = tauri();
  if (t) {
    let id = await t.invoke("load_device_id");
    if (!id) { id = crypto.randomUUID(); await t.invoke("save_device_id", { id }); }
    return id;
  }
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch { return crypto.randomUUID(); }
}

// Coalesces rapid edits into one write.
export function debounce(fn, ms) {
  let timer;
  const run = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  run.flush = (...args) => { clearTimeout(timer); return fn(...args); };
  return run;
}
