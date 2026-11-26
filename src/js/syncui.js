// Sync screen (spec 3.7 sync group, 6.3): create or join a sync group, add
// devices, sync now, and manage the member list.
//
// Every connection is "a device shows a QR code, the phone scans it". The
// native core supplies the encrypted pipe; devsync.js runs the protocol.

import { h, fill, select } from "./dom.js";
import {
  runScanner, runShower, createGroup, parseQr, buildQr, checkPhrase, randomCode, SyncError,
} from "./devsync.js";
import { DEVICE_KINDS } from "./model.js";

const tauri = () => globalThis.__TAURI__?.core;
const ACCEPT_SECS = 120;

export const SYNC_HELP = {
  "timed-out": "No answer from the other device. Check both are on the same Wi-Fi (or the phone is on the computer's hotspot), and that Windows Firewall allowed Work Dashboard on private networks. Settings → Network check can confirm the network works.",
  refused: "The other device isn't waiting any more. Show a new code on it and scan again.",
  "wrong-code": "That code is no longer valid. Scan the code that's on the screen now.",
  "wrong-device": "The device that answered isn't the one in the QR code, so nothing was sent.",
  "not-member": "That device isn't in your sync group (it may have been removed). Add it again with Add a device.",
  "not-in-group": "This device isn't in a sync group yet.",
  "already-in-group": "That device is already in a sync group.",
  "phrase-rejected": "The check phrase wasn't confirmed, so the device wasn't added.",
  "id-clash": "Another device already uses that device id. Nothing was changed.",
  version: "The two devices run different app versions. Update both to the newest test build.",
  closed: "The connection closed before sync finished. Try again.",
  cancelled: "Cancelled.",
};

const helpFor = (err) => SYNC_HELP[err?.code ?? String(err)] ?? `Sync failed: ${err?.message ?? err}`;

// Adapts the native pipe commands to the { send, recv } interface devsync expects.
function nativePipe(t, peer) {
  return {
    peerKey: peer.peerKey,
    handshakeHash: peer.handshakeHash,
    send: (obj) => t.invoke("pipe_send", { text: JSON.stringify(obj) }),
    recv: async () => {
      try { return JSON.parse(await t.invoke("pipe_recv", { timeoutSecs: 90 })); } catch (e) { throw new SyncError(String(e)); }
    },
  };
}

function since(iso) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 36) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

export function lastSyncedAt(store) {
  const all = Object.values(store.getLocal().lastSync);
  return all.length ? all.sort().at(-1) : null;
}

/** One-line sync status for the dashboard, or null when not in a group. */
export function syncSummary(store, deviceId) {
  if (!store.get("devices", deviceId)) return null;
  const last = lastSyncedAt(store);
  const stale = !last || Date.now() - Date.parse(last) > 24 * 3600 * 1000;
  return { text: last ? `Last synced ${since(last)}` : "Not synced yet", stale };
}

// The result of the last sync stays visible when the screen redraws.
let lastMessage = null;

export function syncView(store, { deviceId, isAndroid, confirm, hold = (fn) => fn() }) {
  const t = tauri();
  if (!t) {
    return h("section", { class: "view narrow" }, h("div", { class: "card" }, h("h2", {}, "Sync"),
      h("p", { class: "muted" }, "Sync only works in the installed app.")));
  }
  const kind = isAndroid ? "phone" : "computer";
  const panel = h("div", { class: "card" });
  const root = h("section", { class: "view narrow" });
  let identity = null;

  async function me() {
    identity ??= await t.invoke("identity_info");
    const rec = store.get("devices", deviceId);
    return {
      id: deviceId,
      name: rec?.name ?? (isAndroid ? "Phone" : identity.deviceName),
      kind: rec?.kind ?? kind,
      publicKey: identity.publicKey,
    };
  }

  // ---- Showing a code (computer / tablet / kiosk) ----------------------------
  const showCode = (mode) => hold(() => showCodeInner(mode));
  const scan = () => hold(scanInner);

  async function showCodeInner(mode) {
    lastMessage = null;
    const code = randomCode();
    const status = h("p", { class: "big", role: "status" }, "Starting…");
    const extra = h("div", {});
    const qrImg = h("img", { class: "qr", alt: "Sync code", width: 240, height: 240 });
    const cancel = h("button", { class: "btn", onclick: () => t.invoke("pipe_close") }, "Cancel");
    const intro = {
      sync: "On the phone: Settings → Sync → Scan code.",
      invite: "On the new phone: Settings → Sync → Scan code.",
      join: "On a phone that's already in your sync group: Settings → Sync → Scan code.",
    }[mode];
    fill(panel, h("h2", {}, { sync: "Sync now", invite: "Add a phone", join: "Join a sync group" }[mode]),
      h("p", {}, intro), qrImg, status, extra, h("div", { class: "actions" }, cancel));
    try {
      const self = await me();
      const listen = await t.invoke("pipe_listen");
      if (!listen.ips.length) throw new SyncError("no-network", "This device isn't on a local network. Connect to Wi-Fi or turn on its hotspot.");
      qrImg.src = await t.invoke("qr_svg", { text: buildQr({ mode, ips: listen.ips, port: listen.port, key: self.publicKey, code }) });
      status.textContent = "Waiting for the phone…";
      const peer = await t.invoke("pipe_accept", { timeoutSecs: ACCEPT_SECS });
      const phrase = checkPhrase(peer.handshakeHash);
      if (mode === "join") {
        fill(extra, h("p", {}, "Check phrase (the phone will ask you to compare):"), h("p", { class: "phrase" }, phrase));
      }
      status.textContent = "Connected. Syncing…";
      const result = await runShower({
        pipe: nativePipe(t, peer), store, mode, code, me: self,
        confirmPhrase: (p, name) => askPhrase(extra, p, name),
      });
      done(`✓ ${mode === "sync" ? "Synced with" : "Added"} ${result.peer.name}. ${result.received} change(s) received.`);
    } catch (err) {
      failed(err);
    } finally {
      t.invoke("pipe_close").catch(() => {});
    }
  }

  // ---- Scanning (phone) ------------------------------------------------------
  async function scanInner() {
    lastMessage = null;
    const status = h("p", { class: "big", role: "status" }, "Opening camera…");
    const extra = h("div", {});
    fill(panel, h("h2", {}, "Scan code"), status, extra);
    try {
      try { await t.invoke("plugin:barcode-scanner|request_permissions"); } catch { /* scan asks */ }
      const res = await t.invoke("plugin:barcode-scanner|scan", { windowed: false, formats: ["QR_CODE"] });
      const qr = parseQr(res?.content);
      if (!qr) throw new SyncError("bad-qr", "That isn't a Work Dashboard sync code. (Network check codes are on a different screen.)");
      status.textContent = "Connecting…";
      const self = await me();
      const peer = await t.invoke("pipe_connect", { ips: qr.ips, port: qr.port });
      const phrase = checkPhrase(peer.handshakeHash);
      if (qr.mode === "invite") {
        fill(extra, h("p", {}, "Check that the computer shows the same words, then confirm there:"), h("p", { class: "phrase" }, phrase));
      }
      status.textContent = qr.mode === "invite" ? "Waiting for the computer to confirm…" : "Syncing…";
      const result = await runScanner({
        pipe: nativePipe(t, peer), store, qr, me: self,
        confirmPhrase: (p, name) => askPhrase(extra, p, name),
      });
      done(`✓ ${qr.mode === "sync" ? "Synced with" : qr.mode === "join" ? "Added" : "Joined the sync group with"} ${result.peer.name}. ${result.received} change(s) received.`);
    } catch (err) {
      failed(err);
    } finally {
      t.invoke("pipe_close").catch(() => {});
    }
  }

  function askPhrase(box, phrase, name) {
    return new Promise((resolve) => {
      fill(box,
        h("p", {}, `Does ${name} show these words?`),
        h("p", { class: "phrase" }, phrase),
        h("div", { class: "actions" },
          h("button", { class: "btn danger", onclick: () => resolve(false) }, "No, they differ"),
          h("button", { class: "btn primary", onclick: () => { fill(box, h("p", { class: "muted" }, "Confirmed.")); resolve(true); } }, "Yes, they match")));
    });
  }

  function done(text) {
    lastMessage = { ok: true, text };
    render();
  }

  function failed(err) {
    lastMessage = { ok: false, text: helpFor(err) };
    render();
  }

  function banner() {
    if (!lastMessage) return null;
    return lastMessage.ok
      ? h("p", { class: "big ok", role: "status" }, lastMessage.text)
      : h("div", {}, h("p", { class: "errors", role: "alert" }, lastMessage.text), hotspotHelp());
  }

  // When the Wi-Fi blocks devices from reaching each other (spec 6.3).
  function hotspotHelp() {
    return h("details", { class: "manual" }, h("summary", {}, "Sync over this computer's hotspot instead"),
      h("ol", { class: "steps" },
        h("li", {}, "On the computer, turn on Mobile hotspot.", !isAndroid ? h("button", { class: "btn small-btn", onclick: () => t.invoke("open_hotspot_settings").catch(() => {}) }, "Open hotspot settings") : null),
        h("li", {}, "On the phone, join the computer's hotspot in Wi-Fi settings (name and password are shown in the hotspot settings)."),
        h("li", {}, "Tap Sync now on the computer and scan again. The code includes the hotspot address."),
        h("li", {}, "Afterwards, switch the phone back to its normal Wi-Fi.")),
      h("p", { class: "small muted" }, "Your phone's own hotspot works too: turn it on, join it from the computer, then sync as usual. Nothing goes over the internet either way."));
  }

  // ---- Main screen -------------------------------------------------------------
  function deviceRow(d) {
    const ro = Boolean(store.readOnlyReason());
    const self = d.id === deviceId;
    const last = store.getLocal().lastSync[d.id];
    const role = select("role", [["full", "Full"], ["view-only", "View-only"]], d.role);
    role.disabled = self || ro;
    role.setAttribute("aria-label", `Role for ${d.name}`);
    role.addEventListener("change", () => store.update("devices", d.id, { role: role.value }));
    return h("li", {},
      h("div", { class: "grow" },
        h("strong", {}, d.name), self ? h("span", { class: "chip" }, "This device") : null,
        h("div", { class: "small muted" }, self ? d.kind : `${d.kind} · last synced with this device: ${since(last)}`)),
      role,
      self || ro ? null : h("button", { class: "link danger", "aria-label": `Remove ${d.name}`, onclick: async () => {
        if (await confirm(`Remove ${d.name} from the sync group? It will no longer be able to sync. Its own copy of the data stays on it, so wipe it or use app lock if it's lost.`)) {
          store.remove("devices", d.id);
          render();
        }
      } }, "Remove"));
  }

  function renameForm(rec) {
    const name = h("input", { name: "name", value: rec.name, maxlength: 40, "aria-label": "This device's name" });
    const kindSel = select("kind", DEVICE_KINDS.map((k) => [k, k[0].toUpperCase() + k.slice(1)]), rec.kind);
    const form = h("form", { class: "inline-form" }, name, kindSel, h("button", { class: "btn", type: "submit" }, "Save"));
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      store.update("devices", rec.id, { name: name.value, kind: kindSel.value });
    });
    return form;
  }

  function render() {
    const rec = store.get("devices", deviceId);
    if (!rec) {
      fill(panel,
        banner(),
        h("h2", {}, "Sync group"),
        h("p", {}, "This device isn't in a sync group yet. Your devices sync directly with each other over Wi-Fi: no account, no server."),
        h("ol", { class: "steps" },
          h("li", {}, "On your computer: Create a sync group."),
          h("li", {}, "On the computer: Add a phone. It shows a QR code."),
          h("li", {}, "On the phone: Scan code, and confirm the 4 words match.")),
        h("div", { class: "actions" },
          isAndroid ? h("button", { class: "btn primary", onclick: scan }, "Scan code") : null,
          !isAndroid ? h("button", { class: "btn primary", onclick: async () => { createGroup(store, await me()); render(); } }, "Create a sync group") : null,
          !isAndroid ? h("button", { class: "btn", onclick: () => showCode("join") }, "Join an existing group") : null),
        isAndroid ? h("p", { class: "small muted" }, "Scan the code from a computer that's in a sync group (Add a phone), or from a new computer's Join screen once this phone is in a group.") : null);
      return;
    }
    const ro = store.readOnlyReason();
    const devices = store.list("devices").sort((a, b) => (a.id === deviceId ? -1 : b.id === deviceId ? 1 : a.name.localeCompare(b.name)));
    fill(panel,
      banner(),
      h("h2", {}, "Sync"),
      h("p", { class: "small muted" }, syncSummary(store, deviceId).text),
      h("div", { class: "actions" },
        isAndroid
          ? h("button", { class: "btn primary", onclick: scan }, "Scan code")
          : h("button", { class: "btn primary", onclick: () => showCode("sync") }, "Sync now"),
        !isAndroid && !ro ? h("button", { class: "btn", onclick: () => showCode("invite") }, "Add a phone") : null),
      isAndroid ? h("p", { class: "small muted" }, "Scan the code shown by a computer's Sync now, Add a phone, or Join screen.") : null,
      h("h2", { class: "spaced" }, "Devices in this group"),
      h("ul", { class: "rows devices" }, devices.map(deviceRow)),
      h("h2", { class: "spaced" }, "This device"),
      ro ? h("p", { class: "small muted" }, ro) : renameForm(rec),
      rec.role === "view-only" ? h("p", { class: "small muted" }, "This device is view-only: it can sync and show everything, but can't make changes.") : null);
  }

  render();
  fill(root, panel);
  return root;
}

