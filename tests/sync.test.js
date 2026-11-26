import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/js/store.js";
import { createClock, parseStamp } from "../src/js/clock.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

// Each device gets its own fake wall clock so tests control "later".
function device(id, start = Date.UTC(2026, 10, 26, 12)) {
  let t = start;
  const s = createStore({ deviceId: id, now: () => new Date(t) });
  s.advance = (ms = 1000) => { t += ms; };
  return s;
}

// Two-way sync the way devices will do it: each sends what the other lacks.
function sync(x, y) {
  const toY = x.changesSince(y.versionVector());
  const toX = y.changesSince(x.versionVector());
  y.merge(toY);
  x.merge(toX);
}

const snapshot = (s) => JSON.stringify(["projects", "tasks", "log", "measurements"].map((c) =>
  s.list(c).map(({ _c, ...r }) => r).sort((a, b) => a.id.localeCompare(b.id))).concat([s.getSettings()]));

test("clock stamps increase even if the wall clock goes backwards", () => {
  let t = 5000;
  const clk = createClock(A, () => t);
  const s1 = clk.tick();
  t = 1000;
  const s2 = clk.tick();
  assert.ok(s2 > s1);
  clk.observe(`0000000099999-00003-${B}`);
  assert.ok(clk.tick() > `0000000099999-00003-${B}`);
  assert.equal(parseStamp(s1).device, A);
});

test("a new device receives everything", () => {
  const a = device(A);
  const p = a.create("projects", { name: "Z3860 Collet", type: "fto", customer: "Acme" });
  a.create("tasks", { projectId: p.id, title: "Program op 1" });
  a.updateSettings({ palette: "B" });
  const b = device(B);
  sync(a, b);
  assert.equal(snapshot(a), snapshot(b));
  assert.equal(b.get("projects", p.id).customer, "Acme");
  assert.equal(b.getSettings().palette, "B");
});

test("edits to different fields on two devices both survive", () => {
  const a = device(A);
  const b = device(B);
  const p = a.create("projects", { name: "Fixture", status: "Active" });
  sync(a, b);
  a.advance(); b.advance();
  a.update("projects", p.id, { status: "On hold" });
  b.update("projects", p.id, { priority: "High" });
  sync(a, b);
  for (const s of [a, b]) {
    assert.equal(s.get("projects", p.id).status, "On hold");
    assert.equal(s.get("projects", p.id).priority, "High");
  }
  assert.equal(snapshot(a), snapshot(b));
});

test("same field edited on both: the later edit wins on both devices", () => {
  const a = device(A);
  const b = device(B);
  const p = a.create("projects", { name: "Old name" });
  sync(a, b);
  a.advance(1000); a.update("projects", p.id, { name: "From A" });
  b.advance(5000); b.update("projects", p.id, { name: "From B (later)" });
  sync(a, b);
  assert.equal(a.get("projects", p.id).name, "From B (later)");
  assert.equal(snapshot(a), snapshot(b));
});

test("a delete beats a concurrent edit and stays deleted", () => {
  const a = device(A);
  const b = device(B);
  const p = a.create("projects", { name: "Doomed" });
  sync(a, b);
  a.advance(); a.remove("projects", p.id);
  b.advance(9000); b.update("projects", p.id, { name: "Edited after" });
  sync(a, b);
  assert.equal(a.get("projects", p.id), undefined);
  assert.equal(b.get("projects", p.id), undefined);
  sync(a, b);
  assert.equal(b.get("projects", p.id), undefined);
});

test("the phone carries changes between computers (three devices converge)", () => {
  const pc1 = device(A);
  const phone = device(B);
  const pc2 = device(C);
  const p = pc1.create("projects", { name: "Cell 2 automation", type: "auto" });
  sync(pc1, phone);
  sync(phone, pc2);
  pc2.advance(); pc2.create("log", { projectId: p.id, type: "success", text: "Validated on pc2" });
  pc1.advance(); pc1.update("projects", p.id, { vendor: "ABB" });
  sync(pc2, phone);
  sync(phone, pc1);
  sync(phone, pc2);
  assert.equal(snapshot(pc1), snapshot(phone));
  assert.equal(snapshot(pc2), snapshot(phone));
  assert.equal(pc2.get("projects", p.id).vendor, "ABB");
  assert.equal(pc1.list("log").length, 1);
});

test("merge order doesn't matter, and repeating a merge changes nothing", () => {
  const a = device(A);
  const b = device(B);
  const p = a.create("projects", { name: "X" });
  b.merge(a.changesSince({}));
  a.advance(); a.update("projects", p.id, { status: "Done" });
  b.advance(); b.update("projects", p.id, { priority: "Low" });
  const fromA = a.changesSince({});
  const fromB = b.changesSince({});
  const c1 = device(C); c1.merge(fromA); c1.merge(fromB);
  const c2 = device(C); c2.merge(fromB); c2.merge(fromA);
  assert.equal(snapshot(c1), snapshot(c2));
  assert.equal(c1.merge(fromA).applied, 0);
});

test("changesSince sends only what the other device is missing", () => {
  const a = device(A);
  const b = device(B);
  const p = a.create("projects", { name: "X" });
  a.create("projects", { name: "Y" });
  sync(a, b);
  a.advance(); a.update("projects", p.id, { status: "On hold" });
  const delta = a.changesSince(b.versionVector());
  assert.equal(delta.projects.length, 1);
  assert.deepEqual(Object.keys(delta.projects[0]._c), ["status"]);
  assert.deepEqual(a.changesSince(a.versionVector()).projects, []);
});

test("incoming data is validated: bad records, unknown fields, far-future stamps", () => {
  const b = device(B);
  const future = `${String(Date.UTC(2030, 0, 1)).padStart(13, "0")}-00000-${A}`;
  const ok = `${String(Date.UTC(2026, 10, 26, 11)).padStart(13, "0")}-00000-${A}`;
  const res = b.merge({
    schemaVersion: 1,
    projects: [
      { id: "p1", name: "Good", _c: { name: ok, evil: ok }, evil: "<script>" },
      { id: "p2", name: "", _c: { name: ok } },
      { id: "p3", name: "From the future", _c: { name: future } },
      { id: "../../etc", name: "Bad id", _c: { name: ok } },
    ],
    settings: { palette: "Z", _c: { palette: ok } },
  });
  assert.equal(b.get("projects", "p1").name, "Good");
  assert.equal(b.get("projects", "p1").evil, undefined);
  assert.equal(b.get("projects", "p2"), undefined);
  assert.equal(b.get("projects", "p3"), undefined);
  assert.equal(res.dropped, 3);
  assert.equal(b.getSettings().palette, "A");
  assert.throws(() => b.merge({ schemaVersion: 99 }), /newer version/);
});

test("data saved before edit stamps loads and then syncs", () => {
  const legacy = JSON.stringify({
    schemaVersion: 1,
    settings: { palette: "C" },
    projects: [{ id: "old1", name: "Saved by phase 1", updatedAt: "2026-11-25T10:00:00.000Z", deviceId: A }],
    tasks: [{ id: "gone", deleted: true, updatedAt: "2026-11-25T11:00:00.000Z", deviceId: A }],
  });
  const a = device(A);
  assert.equal(a.load(legacy), 0);
  const b = device(B);
  sync(a, b);
  assert.equal(b.get("projects", "old1").name, "Saved by phase 1");
  assert.equal(snapshot(a), snapshot(b));
  // Saving and reloading keeps the stamps.
  const a2 = device(A);
  a2.load(a.serialize());
  assert.deepEqual(a2.versionVector(), a.versionVector());
});
