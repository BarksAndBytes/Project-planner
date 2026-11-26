import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/js/store.js";
import { buildSummary, reword, periodRange, summaryToText, entriesToCsv, csvCell } from "../src/js/summary.js";

const ID = "aaaaaaaa-0000-4000-8000-000000000001";

function seeded() {
  const s = createStore({ deviceId: ID, now: () => new Date("2026-11-20T12:00:00Z") });
  const fto = s.create("projects", { name: "Z3860 Collet", type: "fto", customer: "Acme", stage: 5, status: "Done" });
  const ci = s.create("projects", { name: "4410 bracket setup", type: "ci", metric: "setup time", unit: "min", baseline: 42, target: 25 });
  const auto = s.create("projects", { name: "Robotic deburr cell", type: "auto", stage: 4 });
  s.create("measurements", { projectId: ci.id, value: 28, date: "2026-11-10" });
  s.create("log", { projectId: ci.id, type: "success", text: "I was able to cut setup with a quick-change plate.", impact: ["time"], impactValue: 6, impactUnit: "h/week", starred: true, date: "2026-11-11" });
  s.create("log", { projectId: fto.id, type: "success", text: "Shipped 2 days early", impact: ["delivery"], date: "2026-11-05" });
  s.create("log", { projectId: auto.id, type: "success", text: "Trained second shift on the cell", impact: ["capability"], date: "2026-11-12" });
  s.create("log", { projectId: auto.id, type: "recognition", text: "Great job on the cell", from: "Plant manager", date: "2026-11-15" });
  s.create("log", { projectId: auto.id, type: "failure", text: "Gripper dropped parts at speed", lesson: "Validate grip force at full rate first", date: "2026-11-08" });
  s.create("log", { projectId: auto.id, type: "note", text: "Old note", date: "2025-01-01" });
  s.create("tasks", { projectId: ci.id, title: "Roll out to 4420", dueDate: "2026-12-01" });
  return { s, fto, ci, auto };
}

const NOV = { from: "2026-11-01", to: "2026-11-30", label: "November 2026" };

test("periods", () => {
  assert.deepEqual(periodRange("quarter", { today: "2026-11-26" }), { from: "2026-10-01", to: "2026-12-31", label: "Q4 2026" });
  assert.deepEqual(periodRange("month", { today: "2026-02-10" }), { from: "2026-02-01", to: "2026-02-28", label: "February 2026" });
  assert.equal(periodRange("review", { today: "2026-11-26", lastReviewDate: "2026-03-01" }).label, "Since Mar 1, 2026");
});

test("rewording removes filler, keeps the user's words, adds the number", () => {
  assert.deepEqual(reword({ text: "I was able to cut setup with a quick-change plate.", impactValue: 6, impactUnit: "h/week" }),
    { text: "Cut setup with a quick-change plate, 6 h/week", changed: true });
  assert.equal(reword({ text: "got the 2-OP fixture done" }).text, "Completed the 2-OP fixture");
  assert.equal(reword({ text: "Helped with the vendor audit" }).text, "Supported the vendor audit");
  assert.equal(reword({ text: "fixed the coolant leak on mill 3" }).text, "Resolved the coolant leak on mill 3");
  assert.deepEqual(reword({ text: "Reduced scrap from 3% to 1%" }), { text: "Reduced scrap from 3% to 1%", changed: false });
  assert.equal(reword({ text: "Saved 6 hours a week", impactValue: 6, impactUnit: "h/week" }).text, "Saved 6 hours a week");
});

test("summary leads with highlights and totals, groups results, respects options", () => {
  const { s } = seeded();
  const sum = buildSummary(s, { period: NOV, ownerName: "Scott", today: "2026-11-26" });
  assert.equal(sum.title, "Work Summary: Scott, November 2026");
  assert.equal(sum.highlights[0].text, "Cut setup with a quick-change plate, 6 h/week");
  assert.ok(sum.highlights.some((h) => h.text === "Setup time 42 min to 28 min, down 33%, target 25 min"));
  assert.ok(sum.totals.includes("3 projects"));
  assert.ok(sum.totals.includes("1 first-time order shipped"));
  assert.ok(sum.totals.includes("1 automation project handed off"));
  assert.ok(sum.totals.includes("est. 6 h/week"));
  assert.deepEqual(sum.results.map((g) => g.impact), ["Time", "Delivery"]);
  assert.equal(sum.capability[0].text, "Trained second shift on the cell");
  assert.equal(sum.recognition[0].from, "Plant manager");
  assert.equal(sum.challenges.length, 0, "challenges are off by default");
  assert.ok(sum.nextPriorities.some((n) => n.text === "Roll out to 4420"));
  assert.equal(sum.changes.length, 1);
  const withC = buildSummary(s, { period: NOV, includeChallenges: true });
  assert.equal(withC.challenges[0].lesson, "Validate grip force at full rate first");
  const noRec = buildSummary(s, { period: NOV, includeRecognition: false });
  assert.equal(noRec.recognition.length, 0);
});

test("undoing a wording change keeps the original words", () => {
  const { s } = seeded();
  const first = buildSummary(s, { period: NOV });
  const id = first.changes[0].id;
  const again = buildSummary(s, { period: NOV, keepOriginal: new Set([id]) });
  assert.equal(again.highlights[0].text, "I was able to cut setup with a quick-change plate");
  assert.equal(again.changes.length, 0);
});

test("single project and type filters", () => {
  const { s, auto } = seeded();
  const one = buildSummary(s, { period: NOV, projectIds: [auto.id] });
  assert.equal(one.single.name, "Robotic deburr cell");
  assert.equal(one.delivered.length, 1);
  const ftoOnly = buildSummary(s, { period: NOV, type: "fto" });
  assert.deepEqual(ftoOnly.delivered.map((d) => d.name), ["Z3860 Collet"]);
});

test("plain text output", () => {
  const { s } = seeded();
  const text = summaryToText(buildSummary(s, { period: NOV, ownerName: "Scott", today: "2026-11-26", includeChallenges: true }));
  assert.match(text, /^Work Summary: Scott, November 2026\nPrepared: Nov 26, 2026\n/);
  assert.match(text, /By the numbers\n3 projects · /);
  assert.match(text, /Challenge: Gripper dropped parts at speed  Lesson: Validate/);
  assert.match(text, /"Great job on the cell" \(Plant manager, Nov 15, 2026\)/);
});

test("CSV escapes formulas and quotes", () => {
  assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell("-5"), "'-5");
  assert.equal(csvCell("a,b"), "\"a,b\"");
  const { s } = seeded();
  const csv = entriesToCsv(s, { period: NOV });
  assert.equal(csv.split("\r\n")[0], "Date,Project,Project type,Entry type,Text,Lesson,Impact,Amount,Unit,Highlight,From");
  assert.equal(csv.trim().split("\r\n").length, 6);
});

import { crc32, zip } from "../src/js/zip.js";
import { summaryToDocx, summaryToDocxXml } from "../src/js/docx.js";

test("zip CRC matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const z = zip([{ name: "a.txt", data: "hi" }]);
  assert.equal(new DataView(z.buffer).getUint32(0, true), 0x04034b50);
});

test("Word export escapes text and contains every section", () => {
  const { s, auto } = seeded();
  s.update("projects", auto.id, { name: "Cell <2> & \"QC\"" });
  const sum = buildSummary(s, { period: NOV, includeChallenges: true, ownerName: "Scott" });
  const xml = summaryToDocxXml(sum);
  assert.ok(xml.includes("Cell &lt;2&gt; &amp; &quot;QC&quot;"));
  assert.ok(!xml.includes("<2>"));
  for (const h of ["Highlights", "By the numbers", "Results by impact", "Projects", "Capability built", "Recognition", "Challenges handled", "Next priorities"]) assert.ok(xml.includes(`>${h}<`), h);
  const bytes = summaryToDocx(sum);
  assert.ok(bytes.length > 2000);
});

import { claudePrompt } from "../src/js/summary.js";
import { searchItems } from "../src/js/search.js";

test("Copy for Claude includes the prompt and entries, challenges only when asked", () => {
  const { s } = seeded();
  const text = claudePrompt(s, { period: NOV });
  assert.match(text, /^Write a confident, factual self-assessment/);
  assert.match(text, /Shipped 2 days early/);
  assert.ok(!text.includes("Gripper dropped"));
  assert.match(claudePrompt(s, { period: NOV, includeChallenges: true }), /Gripper dropped parts at speed \[lesson: Validate/);
});

test("search finds projects by customer, tasks, and log text", () => {
  const { s } = seeded();
  const r = searchItems(s, "acme");
  assert.equal(r.projects[0].name, "Z3860 Collet");
  assert.equal(searchItems(s, "4420").tasks.length, 1);
  assert.equal(searchItems(s, "grip force").log.length, 1);
  assert.equal(searchItems(s, "a").projects.length, 0);
});
