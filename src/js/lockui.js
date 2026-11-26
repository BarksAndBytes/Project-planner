// App lock screen, kiosk lock banner, and their Settings cards.

import { h, fill, field } from "./dom.js";
import { hashPasscode, checkPasscode, validRecord, MIN_PASSCODE } from "./lock.js";

function waitText(ms) {
  const m = Math.ceil(ms / 60000);
  return `Too many wrong tries. Try again in ${m} minute${m === 1 ? "" : "s"}.`;
}

/** A passcode form. onSubmit(passcode) -> Promise<string|null> (error text or null). */
export function passcodeForm({ title, intro, button = "Unlock", onSubmit, onCancel }) {
  const input = h("input", { type: "password", inputmode: "numeric", autocomplete: "current-password", "aria-label": "Passcode", autofocus: true });
  const err = h("p", { class: "errors", role: "alert", hidden: true });
  const form = h("form", { class: "form lock-form" },
    h("h2", {}, title), intro ? h("p", { class: "muted" }, intro) : null,
    input, err,
    h("div", { class: "actions" },
      onCancel ? h("button", { class: "btn", type: "button", onclick: onCancel }, "Cancel") : null,
      h("button", { class: "btn primary", type: "submit" }, button)));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = await onSubmit(input.value);
    input.value = "";
    if (msg) { err.textContent = msg; err.hidden = false; input.focus(); }
  });
  return form;
}

/** Verifies against a record with the shared device lockout. Returns error text or null. */
export async function verify(store, record, passcode) {
  const r = await checkPasscode(record, passcode, store.getLocal().lockout);
  store.setLocks({ lockout: r.lockout });
  if (r.ok) return null;
  return r.wait ? waitText(r.wait) : "That passcode isn't right.";
}

export function lockScreen(store, onUnlock) {
  return h("div", { class: "lock-screen" },
    passcodeForm({
      title: "Work Dashboard is locked",
      intro: "Enter your passcode.",
      onSubmit: async (p) => {
        const msg = await verify(store, store.getLocal().appLock, p);
        if (!msg) onUnlock();
        return msg;
      },
    }));
}

function setPasscodeForm(store, { title, onSet, onCancel }) {
  const a = h("input", { type: "password", inputmode: "numeric", autocomplete: "new-password", placeholder: "New passcode", "aria-label": "New passcode" });
  const b = h("input", { type: "password", inputmode: "numeric", autocomplete: "new-password", placeholder: "Repeat it", "aria-label": "Repeat passcode" });
  const err = h("p", { class: "errors", hidden: true });
  const form = h("form", { class: "form" }, h("strong", {}, title), h("div", { class: "row3" }, a, b), err,
    h("div", { class: "actions" }, h("button", { class: "btn", type: "button", onclick: onCancel }, "Cancel"), h("button", { class: "btn primary", type: "submit" }, "Set passcode")));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const show = (m) => { err.textContent = m; err.hidden = false; };
    if (a.value !== b.value) return show("The passcodes don't match.");
    if (a.value.length < MIN_PASSCODE) return show(`Use at least ${MIN_PASSCODE} characters.`);
    onSet(await hashPasscode(a.value));
  });
  return form;
}

export function appLockCard(store) {
  const box = h("div", {});
  const render = () => {
    const lock = store.getLocal().appLock;
    if (!validRecord(lock)) {
      fill(box, h("p", { class: "small muted" }, "Ask for a passcode whenever the app opens. (Your data is already encrypted on this device; this stops someone using the app if they pick up your phone or PC.)"),
        h("button", { class: "btn", onclick: () => fill(box, setPasscodeForm(store, { title: "Set an app passcode", onSet: (r) => { store.setLocks({ appLock: r }); }, onCancel: render })) }, "Turn on app lock"));
    } else {
      fill(box, h("p", { class: "small ok" }, "App lock is on for this device."),
        h("button", { class: "btn", onclick: () => fill(box, passcodeForm({ title: "Turn off app lock", button: "Turn off", onCancel: render,
          onSubmit: async (p) => { const m = await verify(store, lock, p); if (!m) store.setLocks({ appLock: null }); return m; } })) }, "Turn off app lock"));
    }
  };
  render();
  return h("div", { class: "card" }, h("h2", {}, "App lock"), box);
}

export function kioskCard(store) {
  const box = h("div", {});
  const render = () => {
    const k = store.getLocal().kiosk;
    if (!k?.enabled) {
      fill(box, h("p", { class: "small muted" }, "For a device mounted in a shared spot: everything stays visible, but it's read-only until you enter its passcode. It locks again after 5 idle minutes or when you tap Lock. It also uses bigger touch targets."),
        h("button", { class: "btn", onclick: () => fill(box, setPasscodeForm(store, { title: "Set this kiosk's passcode", onSet: (r) => store.setLocks({ kiosk: { enabled: true, passcode: r } }), onCancel: render })) }, "Turn on kiosk mode"));
    } else {
      fill(box, h("p", { class: "small ok" }, "Kiosk mode is on for this device."),
        h("button", { class: "btn", onclick: () => fill(box, passcodeForm({ title: "Turn off kiosk mode", button: "Turn off", onCancel: render,
          onSubmit: async (p) => { const m = await verify(store, k.passcode, p); if (!m) store.setLocks({ kiosk: null }); return m; } })) }, "Turn off kiosk mode"));
    }
  };
  render();
  return h("div", { class: "card" }, h("h2", {}, "Kiosk mode"), box);
}

export { field };
