// Device sync protocol (spec 6.2, 6.3).
//
// The native core provides an encrypted, authenticated pipe (Noise XX):
// after the handshake each side knows the other's identity key for certain,
// and both share a handshake hash. Everything here runs over that pipe:
// membership checks, the one-time code, the check phrase for joining, and
// the exchange of changes. It is plain JavaScript so it is fully tested
// with an in-memory pipe (tests/devsync.test.js).
//
// Three modes, always "a device shows a QR code, the phone scans it":
//   sync   - both are members: swap changes.
//   invite - the device showing the code is a member; the scanner is new.
//   join   - the device showing the code is new; the scanner is a member.
// For invite/join, the member confirms a 4-word check phrase that both
// screens derive from the handshake, which stops a swapped QR code.

export const PROTOCOL = 1;
const MODES = ["sync", "invite", "join"];
const QR_RE = /^wdsync:1:(sync|invite|join):((?:\d{1,3}(?:\.\d{1,3}){3},?){1,4}):(\d{1,5}):([A-Za-z0-9+/]{43}=):([0-9a-f]{32})$/;

export const WORDS = [
  "amber", "anchor", "anvil", "apple", "arrow", "atlas", "autumn", "badge", "bagel", "banjo", "barn", "basil", "beacon", "beaver", "bench", "birch",
  "bison", "blade", "blaze", "bloom", "bolt", "bonus", "boot", "brass", "bread", "brick", "bridge", "brook", "broom", "bucket", "buffalo", "butter",
  "cabin", "cactus", "camel", "candle", "canoe", "canyon", "carbon", "cargo", "carrot", "castle", "cedar", "cello", "chalk", "cherry", "chess", "chili",
  "cider", "circle", "citrus", "clamp", "cliff", "clock", "cloud", "clover", "cobalt", "cocoa", "comet", "copper", "coral", "cotton", "cougar", "crane",
  "crater", "crayon", "cricket", "crown", "crystal", "cubic", "dagger", "daisy", "delta", "denim", "desert", "diesel", "dingo", "dolphin", "domino", "donkey",
  "dragon", "drift", "drill", "drum", "eagle", "easel", "echo", "eclipse", "elbow", "elder", "ember", "emerald", "engine", "falcon", "fender", "fern",
  "ferry", "fiddle", "figure", "filter", "flame", "flint", "forest", "fossil", "fox", "frost", "galaxy", "garnet", "gecko", "geyser", "ginger", "glacier",
  "globe", "goose", "granite", "grape", "gravel", "guitar", "gull", "hammer", "harbor", "harp", "hawk", "hazel", "helmet", "heron", "hickory", "honey",
  "hornet", "husky", "igloo", "indigo", "iris", "island", "ivory", "jacket", "jade", "jaguar", "jasper", "jelly", "jigsaw", "kayak", "kettle", "kiwi",
  "koala", "ladder", "lagoon", "lantern", "laser", "lava", "lemon", "lever", "lilac", "lime", "linen", "lizard", "llama", "lobster", "locket", "lotus",
  "lumber", "magnet", "mango", "maple", "marble", "meadow", "melon", "mesa", "meteor", "metro", "mint", "mirror", "moose", "mortar", "motor", "mustard",
  "nectar", "nickel", "nimbus", "noodle", "north", "nutmeg", "oak", "oasis", "ocean", "olive", "onyx", "opal", "orbit", "orchid", "otter", "oyster",
  "paddle", "panda", "panther", "parrot", "pastel", "peach", "pebble", "pecan", "pepper", "piano", "pickle", "pilot", "pine", "piston", "planet", "plum",
  "polar", "pony", "poppy", "prism", "pulse", "puma", "quartz", "quill", "rabbit", "radar", "radish", "raven", "reef", "ribbon", "river", "robin",
  "rocket", "rose", "ruby", "saddle", "saffron", "salmon", "sandal", "satin", "scarf", "sequoia", "shadow", "shark", "shovel", "silver", "sketch", "sled",
  "slate", "socket", "sonic", "spark", "sparrow", "spruce", "squid", "stamp", "steel", "stone", "storm", "sugar", "summit", "swan", "tango", "teal",
];

export class SyncError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

/** Four words from the first four bytes of the handshake hash (hex). */
export function checkPhrase(handshakeHashHex) {
  const h = String(handshakeHashHex);
  if (!/^[0-9a-f]{8,}$/i.test(h)) throw new SyncError("bad-hash");
  return [0, 2, 4, 6].map((i) => WORDS[parseInt(h.slice(i, i + 2), 16)]).join(" - ");
}

export function buildQr({ mode, ips, port, key, code }) {
  return `wdsync:1:${mode}:${ips.slice(0, 4).join(",")}:${port}:${key}:${code}`;
}

export function parseQr(text) {
  const m = QR_RE.exec(String(text ?? "").trim());
  if (!m) return null;
  const ips = m[2].split(",").filter(Boolean);
  const port = Number(m[3]);
  if (port < 1 || port > 65535 || ips.some((ip) => ip.split(".").some((o) => Number(o) > 255))) return null;
  return { mode: m[1], ips, port, key: m[4], code: m[5] };
}

export function randomCode() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ---- Group helpers --------------------------------------------------------

export const memberByKey = (store, key) => store.list("devices").find((d) => d.publicKey === key);
export const inGroup = (store, me) => Boolean(store.get("devices", me.id));

export function createGroup(store, me) {
  if (inGroup(store, me)) return store.get("devices", me.id);
  return store.create("devices", { name: me.name, kind: me.kind, publicKey: me.publicKey, role: "full", addedBy: me.id }, { id: me.id });
}

function addMember(store, me, peer, peerKey) {
  const existing = store.get("devices", peer.id);
  if (existing) {
    if (existing.publicKey !== peerKey) throw new SyncError("id-clash", "That device id is already used by another device.");
    return existing;
  }
  return store.create("devices", { name: peer.name, kind: peer.kind, publicKey: peerKey, role: "full", addedBy: me.id }, { id: peer.id });
}

/** Edits made by view-only members are refused on every device. */
export function acceptOriginFor(store) {
  return (deviceId) => store.get("devices", deviceId)?.role !== "view-only";
}

function cleanDevice(d) {
  const id = String(d?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new SyncError("bad-hello");
  return {
    id: id.toLowerCase(),
    name: String(d?.name ?? "Device").slice(0, 40) || "Device",
    kind: ["phone", "computer", "tablet", "kiosk"].includes(d?.kind) ? d.kind : "computer",
  };
}

async function recvType(pipe, type) {
  const msg = await pipe.recv();
  if (!msg || typeof msg !== "object") throw new SyncError("bad-message");
  if (msg.t === "error") throw new SyncError(msg.code ?? "peer-error", msg.message);
  if (msg.t !== type) throw new SyncError("unexpected", `Expected ${type}, got ${msg.t}`);
  return msg;
}

async function fail(pipe, code, message) {
  try { await pipe.send({ t: "error", code, message }); } catch { /* peer gone */ }
  throw new SyncError(code, message);
}

function mergeFrom(store, data) {
  return store.merge(data ?? {}, { acceptOrigin: acceptOriginFor(store) });
}

// ---- Scanning side (the phone) ----------------------------------------------

/**
 * @param pipe   { peerKey, handshakeHash, send(obj), recv() }
 * @param qr     parsed QR (parseQr)
 * @param me     { id, name, kind, publicKey }
 * @param confirmPhrase(phrase, peerName) -> Promise<boolean>, when this side is the member in a join
 * @param showPhrase(phrase, peerName)    -> called when the other side confirms (invite)
 */
export async function runScanner({ pipe, store, qr, me, confirmPhrase, showPhrase = () => {} }) {
  if (pipe.peerKey !== qr.key) await fail(pipe, "wrong-device", "The device that answered isn't the one in the QR code.");
  const member = inGroup(store, me);
  if (qr.mode === "sync") {
    if (!member) throw new SyncError("not-in-group", "This device isn't in a sync group yet. Join one first.");
    const peer = memberByKey(store, pipe.peerKey);
    if (!peer) throw new SyncError("not-member", "That device isn't in your sync group (it may have been removed).");
  }
  if (qr.mode === "join" && !member) throw new SyncError("not-in-group", "Only a device that's already in the sync group can add a new one.");
  if (qr.mode === "invite" && member) throw new SyncError("already-in-group", "This device is already in a sync group.");

  await pipe.send({ t: "hello", v: PROTOCOL, mode: qr.mode, code: qr.code, device: { id: me.id, name: me.name, kind: me.kind }, vv: store.versionVector() });
  const hello = await recvType(pipe, "hello");
  const peer = cleanDevice(hello.device);
  const phrase = checkPhrase(pipe.handshakeHash);

  if (qr.mode === "sync") {
    const rec = memberByKey(store, pipe.peerKey);
    if (rec.id !== peer.id) await fail(pipe, "not-member", "Device identity doesn't match the sync group.");
  } else if (qr.mode === "invite") {
    showPhrase(phrase, peer.name); // the other device's user confirmed before answering
  } else if (qr.mode === "join") {
    const ok = await confirmPhrase(phrase, peer.name);
    if (!ok) await fail(pipe, "phrase-rejected", "The check phrase was not confirmed.");
    addMember(store, me, peer, pipe.peerKey);
  }

  await pipe.send({ t: "changes", data: store.changesSince(hello.vv ?? {}) });
  const back = await recvType(pipe, "changes");
  const result = mergeFrom(store, back.data);
  await pipe.send({ t: "done" });
  if (!inGroup(store, me)) throw new SyncError("join-failed", "Joining didn't complete. Try again.");
  store.setLastSync(peer.id, new Date().toISOString());
  return { peer, mode: qr.mode, received: result.applied, dropped: result.dropped };
}

// ---- Code-showing side (computer, tablet, kiosk) ------------------------------

/**
 * @param mode  "sync" | "invite" | "join"
 * @param code  the one-time code in the QR
 * @param confirmPhrase(phrase, peerName) -> Promise<boolean>, when this side is the member in an invite
 * @param showPhrase(phrase, peerName)    -> called when the scanner confirms (join)
 */
export async function runShower({ pipe, store, mode, code, me, confirmPhrase, showPhrase = () => {} }) {
  if (!MODES.includes(mode)) throw new SyncError("bad-mode");
  const hello = await recvType(pipe, "hello");
  if (hello.v !== PROTOCOL) await fail(pipe, "version", "The two devices run incompatible versions. Update both.");
  if (hello.mode !== mode || hello.code !== code) await fail(pipe, "wrong-code", "That code is no longer valid. Scan the code on the screen now.");
  const peer = cleanDevice(hello.device);
  const phrase = checkPhrase(pipe.handshakeHash);

  if (mode === "sync") {
    const rec = memberByKey(store, pipe.peerKey);
    if (!inGroup(store, me)) await fail(pipe, "not-in-group", "The other device isn't in a sync group.");
    if (!rec || rec.id !== peer.id) await fail(pipe, "not-member", "This phone isn't in the sync group (it may have been removed).");
  } else if (mode === "invite") {
    if (!inGroup(store, me)) await fail(pipe, "not-in-group", "This device isn't in a sync group.");
    const ok = await confirmPhrase(phrase, peer.name);
    if (!ok) await fail(pipe, "phrase-rejected", "The check phrase was not confirmed.");
    addMember(store, me, peer, pipe.peerKey);
  } else if (mode === "join") {
    if (inGroup(store, me)) await fail(pipe, "already-in-group", "That device is already in a sync group.");
    showPhrase(phrase, peer.name);
  }

  await pipe.send({ t: "hello", v: PROTOCOL, device: { id: me.id, name: me.name, kind: me.kind }, vv: store.versionVector() });
  const incoming = await recvType(pipe, "changes");
  const result = mergeFrom(store, incoming.data);
  if (!inGroup(store, me)) await fail(pipe, "join-failed", "Joining didn't complete.");
  await pipe.send({ t: "changes", data: store.changesSince(hello.vv ?? {}) });
  await recvType(pipe, "done");
  store.setLastSync(peer.id, new Date().toISOString());
  return { peer, mode, received: result.applied, dropped: result.dropped };
}
