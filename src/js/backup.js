// Encrypted backup files (spec 3.7, 6.4). Everything is encrypted with a
// passphrase you choose: PBKDF2-SHA-256 (600,000 rounds) derives an AES-256-GCM
// key, so a copied backup file is useless without the passphrase.
// Restoring merges the backup into this device's data with the same
// field-by-field rules as sync, so nothing newer is ever overwritten.

const FORMAT = "work-dashboard-backup";
const ITERATIONS = 600_000;
export const MIN_PASSPHRASE = 8;

const te = new TextEncoder();
const td = new TextDecoder();

function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", te.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export class BackupError extends Error {}

/** Returns the backup file's bytes. */
export async function createBackup(store, passphrase, { iterations = ITERATIONS, now = new Date() } = {}) {
  if (String(passphrase).length < MIN_PASSPHRASE) throw new BackupError(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const header = { format: FORMAT, v: 1, created: now.toISOString(), kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: b64(salt) }, cipher: { name: "AES-GCM", iv: b64(iv) } };
  const plain = te.encode(JSON.stringify(store.changesSince({})));
  // The header is authenticated too, so it can't be altered without detection.
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(JSON.stringify(header)) }, key, plain));
  return te.encode(JSON.stringify({ ...header, data: b64(ct) }));
}

/** Decrypts a backup file and merges it in. Returns { applied, dropped, created }. */
export async function restoreBackup(store, bytes, passphrase, { silent = false } = {}) {
  let doc;
  try { doc = JSON.parse(td.decode(bytes)); } catch { throw new BackupError("That file isn't a Work Dashboard backup."); }
  if (!doc || doc.format !== FORMAT || doc.v !== 1 || doc.kdf?.name !== "PBKDF2" || doc.cipher?.name !== "AES-GCM") {
    throw new BackupError("That file isn't a Work Dashboard backup.");
  }
  const iterations = Number(doc.kdf.iterations);
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 10_000_000) throw new BackupError("The backup file is damaged.");
  const { data, ...header } = doc;
  let plain;
  try {
    const key = await deriveKey(passphrase, unb64(doc.kdf.salt), iterations);
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(doc.cipher.iv), additionalData: te.encode(JSON.stringify(header)) }, key, unb64(data));
  } catch {
    throw new BackupError("Wrong passphrase, or the file was changed.");
  }
  const result = store.merge(JSON.parse(td.decode(plain)), { silent });
  return { ...result, created: doc.created };
}
