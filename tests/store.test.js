import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, dashboardStats, ValidationError, addDays } from "../src/js/store.js";

const make = () => createStore({ deviceId: "11111111-2222-3333-4444-555555555555" });

test("create stamps id, times, device and schema version", () => {
  const s = make();
  const p = s.create("projects", { name: "Vane fixture" });
  assert.match(p.id, /^[0-9a-f-]{36}$/);
  assert.equal(p.deviceId, "11111111-2222-3333-4444-555555555555");
  assert.equal(p.schemaVersion, 1);
  assert.ok(p.createdAt && p.updatedAt);
});

test("invalid input throws ValidationError and stores nothing", () => {
  const s = make();
  assert.throws(() => s.create("projects", { name: "" }), ValidationError);
  assert.equal(s.list("projects").length, 0);
});

test("delete leaves a tombstone and removes children", () => {
  const s = make();
  const p = s.create("projects", { name: "A" });
  s.create("tasks", { projectId: p.id, title: "t" });
  s.create("log", { projectId: p.id, text: "e" });
  s.remove("projects", p.id);
  assert.equal(s.get("projects", p.id), undefined);
  assert.equal(s.list("tasks").length, 0);
  const doc = JSON.parse(s.serialize());
  assert.equal(doc.projects[0].deleted, true);
  assert.equal(doc.tasks[0].deleted, true);
});

test("advancing a stage logs a success; going back does not", () => {
  const s = make();
  const p = s.create("projects", { name: "PO", type: "fto" });
  s.advanceStage(p.id, 1);
  assert.equal(s.get("projects", p.id).stage, 1);
  assert.deepEqual(s.list("log").map((e) => e.text), ["Reached Programming"]);
  s.advanceStage(p.id, -1);
  assert.equal(s.list("log").length, 1);
  s.advanceStage(p.id, -1); // already at first stage
  assert.equal(s.get("projects", p.id).stage, 0);
});

test("completing a task logs a success once, and can be turned off", () => {
  const s = make();
  const p = s.create("projects", { name: "A" });
  const t = s.create("tasks", { projectId: p.id, title: "Program op 2" });
  s.setTaskDone(t.id, true);
  s.setTaskDone(t.id, true);
  assert.equal(s.list("log").length, 1);
  assert.equal(s.list("log")[0].text, "Completed: Program op 2");
  s.updateSettings({ autoLogTasks: false });
  const t2 = s.create("tasks", { projectId: p.id, title: "Other" });
  s.setTaskDone(t2.id, true);
  assert.equal(s.list("log").length, 1);
});

test("serialize/load round-trips, including settings", () => {
  const a = make();
  const p = a.create("projects", { name: "A", type: "ci", baseline: 42, metric: "setup", unit: "min" });
  a.create("measurements", { projectId: p.id, value: 28, date: "2026-11-20" });
  a.updateSettings({ palette: "C", mode: "dark" });
  const b = make();
  assert.equal(b.load(a.serialize()), 0);
  assert.equal(b.get("projects", p.id).baseline, 42);
  assert.equal(b.latestMeasurement(p.id).value, 28);
  assert.equal(b.getSettings().palette, "C");
});

test("load drops invalid records and treats input as untrusted", () => {
  const s = make();
  const json = JSON.stringify({
    schemaVersion: 1,
    projects: [
      { id: "ok", name: "Good" },
      { id: "bad", name: "" },
      { name: "no id" },
      { id: "x".repeat(100), name: "long id" },
      { id: "evil", name: "<img src=x onerror=alert(1)>", proto: { polluted: true } },
    ],
    settings: { palette: "Q" },
  }).replace('"proto"', '"__proto__"');
  const dropped = s.load(json);
  assert.equal(dropped, 3);
  assert.equal(s.get("projects", "evil").name, "<img src=x onerror=alert(1)>"); // stored as text, rendered as text
  assert.equal({}.polluted, undefined);
  assert.equal(s.getSettings().palette, "A");
});

test("load refuses data from a newer schema", () => {
  assert.throws(() => make().load(JSON.stringify({ schemaVersion: 99 })), /newer version/);
});

test("dashboard counts and lists", () => {
  const s = make();
  const today = "2026-11-25";
  s.create("projects", { name: "Overdue", status: "Active", dueDate: "2026-11-20" });
  const soon = s.create("projects", { name: "Soon", status: "Active", dueDate: addDays(today, 3) });
  s.create("projects", { name: "Hold", status: "On hold" });
  s.create("projects", { name: "Done", status: "Done", dueDate: "2026-11-01" });
  s.create("log", { projectId: soon.id, type: "success", text: "Win", date: today });
  const blk = s.create("log", { projectId: soon.id, type: "blocker", text: "Waiting on tooling", date: today });
  let d = dashboardStats(s, today);
  assert.equal(d.active, 2);
  assert.equal(d.onHold, 1);
  assert.equal(d.overdue, 1);
  assert.equal(d.dueThisWeek, 1);
  assert.equal(d.recentWins[0].project, "Soon");
  assert.equal(d.openBlockers.length, 1);
  s.update("log", blk.id, { resolved: true });
  d = dashboardStats(s, today);
  assert.equal(d.openBlockers.length, 0);
});
