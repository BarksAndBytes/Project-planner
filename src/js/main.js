// App entry: load data, route, render, save.

import { h, clear } from "./dom.js";
import { createStore } from "./store.js";
import { applyTheme } from "./themes.js";
import { loadRaw, saveRaw, getDeviceId, isNative, debounce } from "./persist.js";
import { dashboardView, projectsView, projectFormView, projectView, entryForm, settingsView } from "./views.js";
import { netcheckView } from "./netcheck.js";
import { syncView, syncSummary } from "./syncui.js";

const VERSION = "0.2.0-dev";
const main = document.getElementById("main");
const status = document.getElementById("status");
const dialog = document.getElementById("sheet");
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const listState = { rerender: () => render() };

let store;
let deviceId;
// While a sync session runs, redraws wait so the session's screen isn't replaced.
let holds = 0;
let pendingRender = false;
async function hold(fn) {
  holds++;
  try { return await fn(); } finally {
    holds--;
    if (!holds && pendingRender) { pendingRender = false; render(); }
  }
}

async function boot() {
  deviceId = await getDeviceId();
  store = createStore({ deviceId });
  store.setGuard(() => (store.get("devices", deviceId)?.role === "view-only"
    ? "This device is view-only. Change its role from another device in Settings → Sync." : null));
  try {
    const raw = await loadRaw();
    if (raw) {
      const dropped = store.load(raw);
      if (dropped) setStatus(`${dropped} damaged record(s) were skipped while loading.`, true);
    }
  } catch (err) {
    // Never overwrite data we couldn't read.
    setStatus(`Couldn't load saved data: ${err.message}. Changes won't be saved until this is fixed.`, true);
    store.readOnlyBecauseLoadFailed = true;
  }

  const save = debounce(async () => {
    if (store.readOnlyBecauseLoadFailed) return;
    try { await saveRaw(store.serialize()); setStatus(""); } catch (err) { setStatus(`Save failed: ${err}`, true); }
  }, 300);

  store.subscribe(() => { save(); theme(); render(); });
  addEventListener("hashchange", render);
  darkQuery.addEventListener("change", theme);
  addEventListener("beforeunload", () => save.flush());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") save.flush(); });
  dialog.addEventListener("close", () => clear(dialog));

  theme();
  render();
}

function theme() {
  applyTheme(document.documentElement, store.getSettings(), darkQuery.matches);
}

function setStatus(text, isError = false) {
  status.textContent = text;
  status.hidden = !text;
  status.classList.toggle("error", isError);
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function openQuickLog(projectId, entryId) {
  clear(dialog);
  dialog.append(entryForm(store, { projectId, entryId, confirm: confirmDialog, onDone: () => dialog.close() }));
  if (!dialog.open) dialog.showModal();
}

// Styled confirm (no browser dialogs).
function confirmDialog(message) {
  return new Promise((resolve) => {
    const d = h("dialog", { class: "confirm" },
      h("p", {}, message),
      h("div", { class: "actions" },
        h("button", { class: "btn", onclick: () => { d.close(); resolve(false); } }, "Cancel"),
        h("button", { class: "btn danger", onclick: () => { d.close(); resolve(true); } }, "Delete")));
    d.addEventListener("close", () => { d.remove(); resolve(false); });
    document.body.append(d);
    d.showModal();
  });
}

function render() {
  if (holds) { pendingRender = true; return; }
  if (dialog.open) {
    // Keep an open entry form; the underlying view refreshes when it closes.
    dialog.addEventListener("close", render, { once: true });
    return;
  }
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const ctx = { navigate, openQuickLog, confirm: confirmDialog };
  let view;
  let nav = "dashboard";
  switch (parts[0]) {
    case "projects": view = projectsView(store, listState); nav = "projects"; break;
    case "new": view = projectFormView(store, { navigate }); nav = "projects"; break;
    case "project":
      nav = "projects";
      view = parts[2] === "edit"
        ? projectFormView(store, { id: parts[1], navigate })
        : projectView(store, { ...ctx, id: parts[1], tab: parts[2] });
      break;
    case "settings": view = settingsView(store, { version: VERSION, native: isNative() }); nav = "settings"; break;
    case "sync": view = syncView(store, { deviceId, isAndroid: /Android/i.test(navigator.userAgent), confirm: confirmDialog, hold }); nav = "settings"; break;
    case "netcheck": view = netcheckView({ isAndroid: /Android/i.test(navigator.userAgent) }); nav = "settings"; break;
    default: view = dashboardView(store, { ...ctx, sync: syncSummary(store, deviceId) });
  }
  const focused = document.activeElement?.closest?.("#main") ? document.activeElement.getAttribute("type") : null;
  clear(main);
  main.append(view);
  for (const a of document.querySelectorAll("[data-nav]")) {
    a.classList.toggle("on", a.dataset.nav === nav);
    if (a.dataset.nav === nav) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  if (focused === "search") main.querySelector("input[type=search]")?.focus();
}

document.getElementById("quicklog-tab").addEventListener("click", (ev) => { ev.preventDefault(); openQuickLog(); });
boot();
