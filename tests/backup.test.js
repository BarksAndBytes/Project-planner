import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/js/store.js";
import { createBackup, restoreBackup, BackupError } from "../src/js/backup.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const FAST = { iterations: 100_000 };

test("backup round-trips into an empty device and is not readable without the passphrase", async () => {
  const a = createStore({ deviceId: A });
  const p = a.create("projects", { name: "Secret project", type: "fto", customer: "Acme" });
  a.create("log", { projectId: p.id, type: "success", text: "Shipped early" });
  const file = await createBackup(a, "correct horse battery", FAST);
  const text = new TextDecoder().decode(file);
  assert.ok(!text.includes("Secret project"));
  assert.ok(!text.includes("Acme"));
  const b = createStore({ deviceId: B });
  const r = await restoreBackup(b, file, "correct horse battery");
  assert.ok(r.applied >= 2);
  assert.equal(b.get("projects", p.id).customer, "Acme");
  await assert.rejects(restoreBackup(createStore({ deviceId: B }), file, "wrong passphrase!"), BackupError);
});

test("restoring never overwrites newer edits", async () => {
  let t = Date.UTC(2026, 10, 1);
  const a = createStore({ deviceId: A, now: () => new Date(t += 1000) });
  const p = a.create("projects", { name: "Old name" });
  const file = await createBackup(a, "passphrase-123", FAST);
  a.update("projects", p.id, { name: "Newer name" });
  await restoreBackup(a, file, "passphrase-123");
  assert.equal(a.get("projects", p.id).name, "Newer name");
});

test("tampered or foreign files are refused; short passphrases too", async () => {
  const a = createStore({ deviceId: A });
  a.create("projects", { name: "X" });
  const file = await createBackup(a, "passphrase-123", FAST);
  const doc = JSON.parse(new TextDecoder().decode(file));
  doc.created = "2020-01-01T00:00:00.000Z"; // header is authenticated
  await assert.rejects(restoreBackup(a, new TextEncoder().encode(JSON.stringify(doc)), "passphrase-123"), /Wrong passphrase, or the file was changed/);
  await assert.rejects(restoreBackup(a, new TextEncoder().encode("{\"hello\":1}"), "passphrase-123"), /isn't a Work Dashboard backup/);
  await assert.rejects(createBackup(a, "short"), /at least 8/);
});
