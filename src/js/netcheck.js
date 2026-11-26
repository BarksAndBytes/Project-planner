// Network check screen (phase 2, first task): can the phone reach the
// computer directly on this network? The computer shows a QR code; the
// phone scans it (or types the address) and connects.

import { h, fill, field } from "./dom.js";

const tauri = () => globalThis.__TAURI__?.core;
const PAYLOAD_RE = /^wdcheck:1:(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5}):([0-9a-f]{32})$/;

export function parseCheckPayload(text) {
  const m = PAYLOAD_RE.exec(String(text ?? "").trim());
  if (!m) return null;
  const port = Number(m[2]);
  if (port < 1 || port > 65535 || m[1].split(".").some((o) => Number(o) > 255)) return null;
  return { host: m[1], port, token: m[3] };
}

function randomToken() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export const PROBE_HELP = {
  "timed-out": "No answer. Either this network stops devices from reaching each other (called client isolation, common on company Wi-Fi), or Windows Firewall blocked the app. On the computer: make sure you allowed Work Dashboard when Windows asked, and that the Wi-Fi is set to a Private network. If it still fails, this network needs the hotspot option (coming in a later step).",
  refused: "The computer isn't listening any more. Start the check again on the computer and scan the new code.",
  "wrong-code": "Reached a device, but the code didn't match. Scan the code that's on the computer's screen now.",
  "not-local": "That address isn't on a local network, so the app won't connect to it.",
  "bad-input": "That doesn't look like a valid address and code.",
};

export function netcheckView({ isAndroid }) {
  const t = tauri();
  if (!t) {
    return h("section", { class: "view narrow" }, h("div", { class: "card" }, h("h2", {}, "Network check"),
      h("p", { class: "muted" }, "The network check only works in the installed app.")));
  }

  const hostBox = h("div", {});
  const clientBox = h("div", {});
  let poller = null;
  const stopPolling = () => { if (poller) clearInterval(poller); poller = null; };

  // ---- This device shows the code (normally the computer) ---------------
  async function startHost() {
    stopPolling();
    fill(hostBox, h("p", { class: "muted" }, "Starting…"));
    try {
      const info = await t.invoke("net_check_start", { token: CURRENT.token = randomToken() });
      if (!info.ip) {
        fill(hostBox, h("p", { class: "errors" }, "This device doesn't seem to be on a local network. Connect to Wi-Fi (or a hotspot) and try again."));
        return;
      }
      const status = h("p", { class: "big", role: "status" }, "Waiting for the phone…");
      const timer = h("p", { class: "small muted" }, "");
      fill(hostBox,
        h("p", {}, "On the phone, open Settings → Network check → Scan code."),
        h("img", { class: "qr", src: info.qr, alt: `Network check code for ${info.ip} port ${info.port}`, width: 240, height: 240 }),
        h("p", { class: "small muted" }, `Or type on the phone: ${info.ip}  port ${info.port}  code ${CURRENT.token}`),
        status, timer,
        h("div", { class: "actions" },
          h("button", { class: "btn", onclick: async () => { stopPolling(); await t.invoke("net_check_stop"); fill(hostBox, startButton()); } }, "Stop")));
      poller = setInterval(async () => {
        if (!hostBox.isConnected) { stopPolling(); t.invoke("net_check_stop"); return; }
        const s = await t.invoke("net_check_status");
        timer.textContent = s.listening ? `Code expires in ${s.secondsLeft} s` : "Code expired.";
        if (s.successes > 0) {
          status.textContent = `✓ Phone reached this computer (${s.lastPeer}). Direct sync will work on this network.`;
          status.className = "big ok";
        } else if (s.rejected > 0) {
          status.textContent = "A device connected but used the wrong code.";
        }
        if (!s.listening) {
          stopPolling();
          if (!s.successes) status.textContent = "No phone connected before the code expired. If the phone showed an error, that tells us why.";
        }
      }, 1000);
    } catch (err) {
      fill(hostBox, h("p", { class: "errors" }, `Couldn't start: ${err}`), startButton());
    }
  }
  const CURRENT = { token: "" };
  const startButton = () => h("button", { class: "btn primary", onclick: startHost }, "Show code");

  // ---- This device connects (normally the phone) -------------------------
  async function probe(target) {
    fill(clientBox, h("p", { class: "muted" }, `Connecting to ${target.host}:${target.port}…`));
    try {
      const r = await t.invoke("net_check_probe", target);
      fill(clientBox,
        h("p", { class: "big ok" }, `✓ Reached ${r.deviceName || "the computer"} in ${r.ms} ms.`),
        h("p", {}, "Direct sync will work on this network."),
        clientControls());
    } catch (err) {
      const code = String(err);
      fill(clientBox,
        h("p", { class: "errors" }, PROBE_HELP[code] ?? `Couldn't connect: ${code}`),
        clientControls());
    }
  }

  async function scan() {
    try {
      try { await t.invoke("plugin:barcode-scanner|request_permissions"); } catch { /* scan asks if needed */ }
      const res = await t.invoke("plugin:barcode-scanner|scan", { windowed: false, formats: ["QR_CODE"] });
      const target = parseCheckPayload(res?.content);
      if (!target) { fill(clientBox, h("p", { class: "errors" }, "That QR code isn't a Work Dashboard network check code."), clientControls()); return; }
      await probe(target);
    } catch (err) {
      fill(clientBox, h("p", { class: "errors" }, `Scanner problem: ${err}. You can type the address instead.`), clientControls());
    }
  }

  function manualForm() {
    const host = h("input", { name: "host", inputmode: "decimal", placeholder: "192.168.1.20", "aria-label": "Computer address" });
    const port = h("input", { name: "port", inputmode: "numeric", placeholder: "Port", "aria-label": "Port" });
    const code = h("input", { name: "code", placeholder: "32-character code", autocapitalize: "off", "aria-label": "Code" });
    const form = h("form", { class: "form" },
      h("div", { class: "row3" }, field("Address", host), field("Port", port)),
      field("Code", code),
      h("button", { class: "btn", type: "submit" }, "Connect"));
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const target = parseCheckPayload(`wdcheck:1:${host.value.trim()}:${port.value.trim()}:${code.value.trim().toLowerCase()}`);
      if (!target) { fill(clientBox, h("p", { class: "errors" }, PROBE_HELP["bad-input"]), clientControls()); return; }
      probe(target);
    });
    return form;
  }

  function clientControls() {
    return h("div", {},
      h("div", { class: "actions" },
        isAndroid ? h("button", { class: "btn primary", onclick: scan }, "Scan code") : null),
      h("details", { class: "manual" }, h("summary", {}, "Type the address instead"), manualForm()));
  }

  fill(hostBox, startButton());
  fill(clientBox, clientControls());
  const myIp = h("span", {}, "…");
  t.invoke("local_ip").then((ip) => { myIp.textContent = ip ?? "not on a local network"; }).catch(() => { myIp.textContent = "unknown"; });

  return h("section", { class: "view narrow" },
    h("div", { class: "card" },
      h("h2", {}, "Network check"),
      h("p", {}, "Checks whether your phone can reach this computer directly on the current network, which is what sync will need. Try it on each network you use, especially at work. No data is sent, only a one-time code."),
      h("p", { class: "small muted" }, "This device's address: ", myIp)),
    h("div", { class: "card" },
      h("h2", {}, isAndroid ? "Connect to a computer" : "Connect from a phone"),
      isAndroid ? clientBox : hostBox),
    h("div", { class: "card" },
      h("h2", {}, isAndroid ? "Or let a computer connect to this phone" : "Or connect this computer to another device"),
      h("p", { class: "small muted" }, isAndroid
        ? "Useful on your phone's own hotspot: show a code here and type its address on the computer."
        : "Type the address and code shown on the other device."),
      isAndroid ? hostBox : clientBox));
}
