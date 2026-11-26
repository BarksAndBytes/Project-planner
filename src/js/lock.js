// Passcodes for app lock and kiosk mode (spec 3.7, 12.8; checklist item 6).
// Only a salted PBKDF2-SHA-256 hash is stored, on this device only (never
// synced). After 5 wrong tries, entry is blocked for 5 minutes; the count
// survives restarts.

const te = new TextEncoder();
export const MIN_PASSCODE = 4;
export const MAX_TRIES = 5;
export const BLOCK_MS = 5 * 60 * 1000;
export const KIOSK_IDLE_MS = 5 * 60 * 1000;
const ITERATIONS = 200_000;

const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s) => new Uint8Array(s.match(/../g).map((x) => parseInt(x, 16)));

async function derive(passcode, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", te.encode(passcode), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export async function hashPasscode(passcode, { iterations = ITERATIONS } = {}) {
  if (String(passcode).length < MIN_PASSCODE) throw new Error(`Use at least ${MIN_PASSCODE} characters.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: hex(salt), hash: await derive(passcode, salt, iterations), iterations };
}

export function validRecord(r) {
  return Boolean(r && /^[0-9a-f]{32}$/.test(r.salt) && /^[0-9a-f]{64}$/.test(r.hash) && Number.isInteger(r.iterations) && r.iterations >= 10_000 && r.iterations <= 5_000_000);
}

/**
 * Checks a passcode against a stored record, with lockout.
 * `lockout` is { fails, until } (device-local); returns { ok, lockout, wait }.
 */
export async function checkPasscode(record, passcode, lockout = { fails: 0, until: 0 }, now = Date.now()) {
  if (lockout.until && now < lockout.until) return { ok: false, lockout, wait: lockout.until - now };
  const hash = await derive(passcode, unhex(record.salt), record.iterations);
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ record.hash.charCodeAt(i);
  if (diff === 0) return { ok: true, lockout: { fails: 0, until: 0 }, wait: 0 };
  const fails = (lockout.fails ?? 0) + 1;
  const next = fails >= MAX_TRIES ? { fails: 0, until: now + BLOCK_MS } : { fails, until: 0 };
  return { ok: false, lockout: next, wait: next.until ? BLOCK_MS : 0 };
}
