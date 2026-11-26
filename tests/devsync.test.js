import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/js/store.js";
import {
  runScanner, runShower, createGroup, parseQr, buildQr, checkPhrase, memberByKey, randomCode, SyncError,
} from "../src/js/devsync.js";

const KEYS = { pc: "A".repeat(43) + "=", phone: "B".repeat(43) + "=", pc2: "C".repeat(43) + "=", evil: "E".repeat(43) + "=" };
const IDS = {
  pc: "aaaaaaaa-0000-4000-8000-000000000001",
  phone: "bbbbbbbb-0000-4000-8000-000000000002",
  pc2: "cccccccc-0000-4000-8000-000000000003",
  evil: "eeeeeeee-0000-4000-8000-00000000000e",
};
const HASH = "0123456789abcdef0123456789abcdef";

function dev(name, kind) {
  let t = Date.UTC(2026, 10, 26, 12);
  const store = createStore({ deviceId: IDS[name], now: () => new Date(t += 10) });
  return { store, me: { id: IDS[name], name, kind, publicKey: KEYS[name] } };
}

// An in-memory pipe pair, like the Noise pipe: each end knows the other's key.
function pipes(scannerKey, showerKey, hash = HASH) {
  const qa = [], qb = [], wa = [], wb = [];
  const mk = (inbox, waiters, outbox, outWaiters, peerKey) => ({
    peerKey, handshakeHash: hash,
    async send(obj) { const m = JSON.parse(JSON.stringify(obj)); const w = outWaiters.shift(); if (w) w(m); else outbox.push(m); },
    recv() { return inbox.length ? Promise.resolve(inbox.shift()) : new Promise((r) => waiters.push(r)); },
  });
  return { scanner: mk(qa, wa, qb, wb, showerKey), shower: mk(qb, wb, qa, wa, scannerKey) };
}

async function session({ scanner, shower, mode, confirm = true, scannerSeesKey, code = randomCode(), scannerCode = code }) {
  const p = pipes(scanner.me.publicKey, shower.me.publicKey);
  if (scannerSeesKey) p.scanner.peerKey = scannerSeesKey;
  const qr = parseQr(buildQr({ mode, ips: ["192.168.1.20"], port: 50000, key: shower.me.publicKey, code: scannerCode }));
  const results = await Promise.allSettled([
    runScanner({ pipe: p.scanner, store: scanner.store, qr, me: scanner.me, confirmPhrase: async () => confirm }),
    runShower({ pipe: p.shower, store: shower.store, mode, code, me: shower.me, confirmPhrase: async () => confirm }),
  ]);
  return results;
}

const projectNames = (s) => s.list("projects").map((p) => p.name).sort();

test("QR payloads round-trip and reject junk", () => {
  const code = randomCode();
  const q = buildQr({ mode: "join", ips: ["192.168.1.20", "192.168.137.1"], port: 51515, key: KEYS.pc, code });
  assert.deepEqual(parseQr(q), { mode: "join", ips: ["192.168.1.20", "192.168.137.1"], port: 51515, key: KEYS.pc, code });
  for (const bad of ["wdsync:1:steal:1.2.3.4:5:" + KEYS.pc + ":" + code, q + "x", "wdcheck:1:1.2.3.4:5:" + code]) assert.equal(parseQr(bad), null);
  assert.match(checkPhrase(HASH), /^\w+ - \w+ - \w+ - \w+$/);
});

test("fresh start: computer creates the group, phone joins by scanning its invite code", async () => {
  const pc = dev("pc", "computer");
  const phone = dev("phone", "phone");
  createGroup(pc.store, pc.me);
  pc.store.create("projects", { name: "On the computer" });
  phone.store.create("projects", { name: "On the phone before joining" });
  const [a, b] = await session({ scanner: phone, shower: pc, mode: "invite" });
  assert.equal(a.status, "fulfilled", a.reason?.message);
  assert.equal(b.status, "fulfilled", b.reason?.message);
  for (const s of [pc.store, phone.store]) {
    assert.deepEqual(projectNames(s), ["On the computer", "On the phone before joining"]);
    assert.equal(s.list("devices").length, 2);
  }
  assert.equal(memberByKey(pc.store, KEYS.phone).id, IDS.phone);
});

test("adding a second computer: it shows a join code, a member phone scans it", async () => {
  const pc = dev("pc", "computer");
  const phone = dev("phone", "phone");
  const pc2 = dev("pc2", "computer");
  createGroup(pc.store, pc.me);
  pc.store.create("projects", { name: "Group project" });
  await session({ scanner: phone, shower: pc, mode: "invite" });
  const [a, b] = await session({ scanner: phone, shower: pc2, mode: "join" });
  assert.equal(a.status, "fulfilled", a.reason?.message);
  assert.equal(b.status, "fulfilled", b.reason?.message);
  assert.deepEqual(projectNames(pc2.store), ["Group project"]);
  assert.equal(pc2.store.list("devices").length, 3);
  // pc learns about pc2 the next time the phone syncs with it (the phone carries it).
  await session({ scanner: phone, shower: pc, mode: "sync" });
  assert.equal(pc.store.list("devices").length, 3);
});

test("everyday sync swaps changes both ways", async () => {
  const pc = dev("pc", "computer");
  const phone = dev("phone", "phone");
  createGroup(pc.store, pc.me);
  await session({ scanner: phone, shower: pc, mode: "invite" });
  pc.store.create("projects", { name: "Made on PC" });
  phone.store.create("projects", { name: "Made on phone" });
  const [a] = await session({ scanner: phone, shower: pc, mode: "sync" });
  assert.equal(a.status, "fulfilled", a.reason?.message);
  assert.deepEqual(projectNames(pc.store), projectNames(phone.store));
  assert.equal(projectNames(pc.store).length, 2);
  assert.ok(phone.store.getLocal().lastSync[IDS.pc]);
});

test("a rejected check phrase adds nobody", async () => {
  const pc = dev("pc", "computer");
  const phone = dev("phone", "phone");
  createGroup(pc.store, pc.me);
  const [a, b] = await session({ scanner: phone, shower: pc, mode: "invite", confirm: false });
  assert.equal(b.status, "rejected");
  assert.equal(b.reason.code, "phrase-rejected");
  assert.equal(a.status, "rejected");
  assert.equal(pc.store.list("devices").length, 1);
  assert.equal(phone.store.list("devices").length, 0);
});

test("a device that isn't in the group can't sync, and a removed one is refused", async () => {
  const pc = dev("pc", "computer");
  const phone = dev("phone", "phone");
  const evil = dev("evil", "phone");
  createGroup(pc.store, pc.me);
  createGroup(evil.store, evil.me);
  evil.store.create("devices", { name: "pc", kind: "computer", publicKey: KEYS.pc }, { id: IDS.pc });
  const [, b] = await session({ scanner: evil, shower: pc, mode: "sync" });
  assert.equal(b.status, "rejected");
  assert.equal(b.reason.code, "not-member");

  await session({ scanner: phone, shower: pc, mode: "invite" });
  pc.store.remove("devices", IDS.phone);
  const [, b2] = await session({ scanner: phone, shower: pc, mode: "sync" });
  assert.equal(b2.status, "rejected");
  assert.equal(b2.reason.code, "not-member");
});

test("wrong code and wrong device are refused", async () => {
  const pc = dev("pc", "computer");
  const phone = dev("phone", "phone");
  createGroup(pc.store, pc.me);
  await session({ scanner: phone, shower: pc, mode: "invite" });
  const [, b] = await session({ scanner: phone, shower: pc, mode: "sync", scannerCode: randomCode() });
  assert.equal(b.reason.code, "wrong-code");
  const [a] = await session({ scanner: phone, shower: pc, mode: "sync", scannerSeesKey: KEYS.evil });
  assert.equal(a.reason.code, "wrong-device");
});

test("edits from a view-only device are refused by the others", async () => {
  const pc = dev("pc", "computer");
  const phone = dev("phone", "phone");
  createGroup(pc.store, pc.me);
  const p = pc.store.create("projects", { name: "Keep me" });
  await session({ scanner: phone, shower: pc, mode: "invite" });
  pc.store.update("devices", IDS.phone, { role: "view-only" });
  await session({ scanner: phone, shower: pc, mode: "sync" });
  assert.equal(phone.store.get("devices", IDS.phone).role, "view-only");
  // A tampered view-only phone edits anyway: the computer drops it.
  phone.store.update("projects", p.id, { name: "Changed by view-only" });
  await session({ scanner: phone, shower: pc, mode: "sync" });
  assert.equal(pc.store.get("projects", p.id).name, "Keep me");
});

test("the store refuses local edits when the guard says the device is view-only", () => {
  const pc = dev("pc", "computer");
  pc.store.setGuard(() => "This device is view-only.");
  assert.throws(() => pc.store.create("projects", { name: "x" }), /view-only/);
  assert.ok(createGroup(pc.store, pc.me)); // device list still writable by sync flows
  assert.ok(new SyncError("x") instanceof Error);
});
