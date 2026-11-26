import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeProject, normalizeLogEntry, normalizeSettings, describeChange, LIMITS } from "../src/js/model.js";

test("project name is required and capped at 120 characters", () => {
  assert.deepEqual(normalizeProject({ name: "  " }).errors, ["Name is required."]);
  const long = normalizeProject({ name: "x".repeat(130) });
  assert.equal(long.value.name.length, LIMITS.projectName);
  assert.ok(long.errors.some((e) => e.includes("120")));
});

test("unknown project type falls back to Other and drops foreign fields", () => {
  const { value } = normalizeProject({ name: "A", type: "bogus", customer: "X" });
  assert.equal(value.type, "other");
  assert.equal(value.customer, undefined);
});

test("first-time order keeps its fields; part numbers split on commas", () => {
  const { value, errors } = normalizeProject({ name: "PO 1", type: "fto", partNumbers: "V-100, V-200", quantity: "500", shipDate: "2026-12-01" });
  assert.deepEqual(errors, []);
  assert.deepEqual(value.partNumbers, ["V-100", "V-200"]);
  assert.equal(value.quantity, 500);
});

test("bad dates and numbers are reported", () => {
  const { errors } = normalizeProject({ name: "A", type: "ci", dueDate: "12/01/2026", baseline: "abc" });
  assert.ok(errors.some((e) => e.includes("Due date")));
  assert.ok(errors.some((e) => e.includes("Baseline")));
});

test("due before start is an error", () => {
  const { errors } = normalizeProject({ name: "A", startDate: "2026-12-10", dueDate: "2026-12-01" });
  assert.ok(errors.includes("Due date is before the start date."));
});

test("tags are trimmed, de-duplicated and limited to 10", () => {
  const tags = Array.from({ length: 12 }, (_, i) => `t${i}`);
  const r = normalizeProject({ name: "A", tags: [...tags, " t0 "] });
  assert.equal(r.value.tags.length, 10);
  assert.ok(r.errors.length);
});

test("stage index outside the track resets to 0", () => {
  assert.equal(normalizeProject({ name: "A", type: "auto", stage: 9 }).value.stage, 0);
  assert.equal(normalizeProject({ name: "A", type: "auto", stage: 2 }).value.stage, 2);
});

test("log entries default to private, typed, today", () => {
  const { value, errors } = normalizeLogEntry({ projectId: "p", text: "Did it", type: "success" });
  assert.deepEqual(errors, []);
  assert.equal(value.visibility, "private");
  assert.equal(value.source, "typed");
  assert.match(value.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("log entry text is capped at 2,000 characters", () => {
  const r = normalizeLogEntry({ projectId: "p", text: "x".repeat(2100) });
  assert.equal(r.value.text.length, 2000);
  assert.ok(r.errors.length);
});

test("unknown impact chips are dropped; only blockers can be resolved", () => {
  const { value } = normalizeLogEntry({ projectId: "p", text: "a", type: "note", impact: ["time", "evil"], resolved: true });
  assert.deepEqual(value.impact, ["time"]);
  assert.equal(value.resolved, false);
});

test("control characters are stripped from text", () => {
  assert.equal(normalizeLogEntry({ projectId: "p", text: "a\u0000b\u0007c" }).value.text, "abc");
});

test("settings default to Shop Steel, follow device", () => {
  const s = normalizeSettings({ palette: "Z", mode: "neon" }).value;
  assert.equal(s.palette, "A");
  assert.equal(s.mode, "auto");
});

test("before-and-after wording matches the spec example", () => {
  const p = { metric: "setup time", unit: "min", baseline: 42, target: 25 };
  assert.equal(describeChange(p, 28), "Setup time 42 min to 28 min, down 33%, target 25 min");
});

import { parseCheckPayload } from "../src/js/netcheck.js";

test("network check QR payloads are parsed strictly", () => {
  const t = "0123456789abcdef0123456789abcdef";
  assert.deepEqual(parseCheckPayload(`wdcheck:1:192.168.1.20:50123:${t}`), { host: "192.168.1.20", port: 50123, token: t });
  for (const bad of [`wdcheck:1:192.168.1.300:50:${t}`, `wdcheck:1:192.168.1.2:70000:${t}`, `wdcheck:2:192.168.1.2:50:${t}`,
    `wdcheck:1:evil.com:50:${t}`, "https://example.com", `wdcheck:1:10.0.0.1:50:${t}x`]) {
    assert.equal(parseCheckPayload(bad), null, bad);
  }
});
