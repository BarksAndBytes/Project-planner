// Work summary builder (spec 8). Written for a manager or performance
// review: leads with results and numbers, uses confident active wording,
// and stays factual: nothing is invented. Pure functions, fully tested.

import { PROJECT_TYPES, describeChange, todayISO } from "./model.js";

export const RESULT_IMPACTS = ["time", "cost", "quality", "safety", "delivery"];
const IMPACT_LABEL = { time: "Time", cost: "Cost", quality: "Quality", safety: "Safety", delivery: "Delivery" };

// ---- Periods -----------------------------------------------------------------

export function periodRange(kind, { today = todayISO(), lastReviewDate = null, from, to } = {}) {
  const [y, m] = today.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const end = (yy, mm) => `${yy}-${pad(mm)}-${pad(new Date(Date.UTC(yy, mm, 0)).getUTCDate())}`;
  const monthName = (mm) => new Date(Date.UTC(2000, mm - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  switch (kind) {
    case "month": return { from: `${y}-${pad(m)}-01`, to: end(y, m), label: `${monthName(m)} ${y}` };
    case "quarter": {
      const q = Math.floor((m - 1) / 3);
      return { from: `${y}-${pad(q * 3 + 1)}-01`, to: end(y, q * 3 + 3), label: `Q${q + 1} ${y}` };
    }
    case "year": return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) };
    case "review": {
      const f = lastReviewDate ?? `${y}-01-01`;
      return { from: f, to: today, label: `Since ${fmtDate(f)}` };
    }
    default: {
      const f = from ?? `${y}-${pad(m)}-01`;
      const t = to ?? today;
      return { from: f, to: t, label: `${fmtDate(f)} to ${fmtDate(t)}` };
    }
  }
}

export function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// ---- Wording -----------------------------------------------------------------

const FILLER = /^(?:i\s+|we\s+)?(?:was able to|were able to|managed to|finally|eventually|basically)\s+/i;

/**
 * Accomplishment wording: action, then result, then number. Keeps the
 * user's words; only removes filler, tightens weak openings, and adds the
 * measured result if the text doesn't already state it. Returns the new
 * sentence and whether anything changed.
 */
export function reword(entry) {
  const original = String(entry.text ?? "").trim();
  let t = original.replace(/\s+/g, " ").replace(/[.!]+$/, "");
  t = t.replace(FILLER, "");
  t = t.replace(/^(?:i|we)\s+(?=\w+ed\b)/i, ""); // "I reduced..." -> "reduced..."
  let m;
  if ((m = /^helped (?:out )?with\s+(.+)$/i.exec(t))) t = `Supported ${m[1]}`;
  else if ((m = /^got\s+(.+?)\s+(?:done|finished|completed)$/i.exec(t))) t = `Completed ${m[1]}`;
  else if ((m = /^got\s+(.+?)\s+fixed$/i.exec(t))) t = `Resolved ${m[1]}`;
  else if ((m = /^got\s+(.+?)\s+(?:working|running|going)$/i.exec(t))) t = `Brought ${m[1]} into service`;
  else if ((m = /^fixed\s+(.+)$/i.exec(t))) t = `Resolved ${m[1]}`;
  if (entry.impactValue !== null && entry.impactValue !== undefined) {
    const num = `${trimNum(entry.impactValue)}${entry.impactUnit ? ` ${entry.impactUnit}` : ""}`;
    if (!t.includes(String(trimNum(entry.impactValue)))) t += `, ${num}`;
  }
  t = t ? t[0].toUpperCase() + t.slice(1) : t;
  const sentence = t;
  return { text: sentence, changed: sentence !== original.replace(/[.!]+$/, "") };
}

function trimNum(n) {
  return Number.isInteger(n) ? n : Math.round(n * 100) / 100;
}

// ---- Builder -----------------------------------------------------------------

/**
 * @param store   the app store
 * @param opts    { period: {from,to,label}, projectIds?: string[], type?: string,
 *                  includeChallenges?: bool, includeTasks?: bool, includeRecognition?: bool,
 *                  keepOriginal?: Set<entryId>, ownerName?: string, today?: string }
 */
export function buildSummary(store, opts) {
  const { period } = opts;
  const keep = opts.keepOriginal ?? new Set();
  const includeRecognition = opts.includeRecognition !== false;
  const inPeriod = (d) => d && d >= period.from && d <= period.to;

  const projects = store.list("projects", (p) =>
    (!opts.projectIds || opts.projectIds.includes(p.id)) && (!opts.type || p.type === opts.type));
  const projectIds = new Set(projects.map((p) => p.id));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const entries = store.list("log", (e) => projectIds.has(e.projectId) && inPeriod(e.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const measurements = store.list("measurements", (x) => projectIds.has(x.projectId) && inPeriod(x.date));
  const tasksDone = store.list("tasks", (t) => projectIds.has(t.projectId) && t.done && inPeriod((t.doneAt ?? "").slice(0, 10)));

  const touched = new Set([...entries.map((e) => e.projectId), ...measurements.map((x) => x.projectId), ...tasksDone.map((t) => t.projectId)]);
  const active = projects.filter((p) => touched.has(p.id));

  const changes = [];
  const line = (e) => {
    const r = keep.has(e.id) ? { text: e.text.trim().replace(/[.!]+$/, ""), changed: false } : reword(e);
    if (r.changed) changes.push({ id: e.id, original: e.text, reworded: r.text });
    const p = projectById.get(e.projectId);
    return { id: e.id, text: r.text, project: p?.name ?? "", reworded: r.changed };
  };

  const successes = entries.filter((e) => e.type === "success");

  // Highlights: starred first, then the biggest measured impact.
  const ranked = [...successes].sort((a, b) =>
    Number(b.starred) - Number(a.starred) || (b.impactValue ?? -1) - (a.impactValue ?? -1) || b.date.localeCompare(a.date));
  const highlights = ranked.filter((e) => e.starred || e.impactValue !== null).slice(0, 5).map(line);
  for (const p of active.filter((p) => p.type === "ci")) {
    if (highlights.length >= 5) break;
    const last = latest(store, p.id);
    const change = last && describeChange(p, last.value);
    if (change && p.baseline !== null && last.value !== p.baseline) highlights.push({ id: `ci-${p.id}`, text: change, project: p.name, reworded: false });
  }

  // By the numbers.
  const atFinal = (p) => PROJECT_TYPES[p.type].stages.length > 0 && p.stage === PROJECT_TYPES[p.type].stages.length - 1;
  const totals = [];
  if (active.length) totals.push(`${active.length} project${active.length === 1 ? "" : "s"}`);
  const fto = active.filter((p) => p.type === "fto" && (atFinal(p) || p.status === "Done")).length;
  if (fto) totals.push(`${fto} first-time order${fto === 1 ? "" : "s"} shipped`);
  const auto = active.filter((p) => p.type === "auto" && (atFinal(p) || p.status === "Done")).length;
  if (auto) totals.push(`${auto} automation project${auto === 1 ? "" : "s"} handed off`);
  const ciGains = active.filter((p) => p.type === "ci" && measurements.some((x) => x.projectId === p.id)).length;
  if (ciGains) totals.push(`${ciGains} improvement project${ciGains === 1 ? "" : "s"} with measured results`);
  const sums = new Map();
  for (const e of successes) {
    if (e.impactValue === null || !e.impactUnit) continue;
    const key = e.impactUnit.trim().toLowerCase();
    sums.set(key, { unit: e.impactUnit.trim(), total: (sums.get(key)?.total ?? 0) + e.impactValue });
  }
  for (const { unit, total } of sums.values()) totals.push(`est. ${trimNum(total)} ${unit}`);
  if (successes.length) totals.push(`${successes.length} logged win${successes.length === 1 ? "" : "s"}`);

  // Results by impact.
  const results = RESULT_IMPACTS.map((k) => ({
    impact: IMPACT_LABEL[k],
    items: successes.filter((e) => e.impact.includes(k)).map(line),
  })).filter((g) => g.items.length);
  const grouped = new Set(successes.filter((e) => e.impact.some((i) => RESULT_IMPACTS.includes(i))).map((e) => e.id));
  const capabilityEntries = successes.filter((e) => e.impact.includes("capability") || e.impact.includes("helped others"));
  const capIds = new Set(capabilityEntries.map((e) => e.id));
  const otherResults = successes.filter((e) => !grouped.has(e.id) && !capIds.has(e.id)).map(line);

  // Projects delivered / progressed.
  const delivered = active.map((p) => {
    const stages = PROJECT_TYPES[p.type].stages;
    const last = p.type === "ci" ? latest(store, p.id) : null;
    return {
      type: PROJECT_TYPES[p.type].label,
      name: p.name,
      stage: stages.length ? stages[p.stage] : p.status,
      metric: last ? describeChange(p, last.value) : "",
      done: atFinal(p) || p.status === "Done",
    };
  }).sort((a, b) => Number(b.done) - Number(a.done) || a.name.localeCompare(b.name));

  const recognition = includeRecognition
    ? entries.filter((e) => e.type === "recognition").map((e) => ({ id: e.id, quote: e.text.trim(), from: e.from, date: e.date, project: projectById.get(e.projectId)?.name ?? "" }))
    : [];

  const challenges = opts.includeChallenges
    ? entries.filter((e) => e.type === "failure").map((e) => ({ id: e.id, challenge: e.text.trim(), lesson: e.lesson, project: projectById.get(e.projectId)?.name ?? "" }))
    : [];

  const tasks = opts.includeTasks ? tasksDone.map((t) => ({ text: t.title, project: projectById.get(t.projectId)?.name ?? "" })) : [];

  const nextPriorities = [
    ...store.list("tasks", (t) => projectIds.has(t.projectId) && !t.done).map((t) => ({ text: t.title, project: projectById.get(t.projectId)?.name ?? "", due: t.dueDate })),
    ...projects.filter((p) => p.status !== "Done" && !p.archived && PROJECT_TYPES[p.type].stages.length && !atFinal(p))
      .map((p) => ({ text: `Next stage: ${PROJECT_TYPES[p.type].stages[p.stage + 1]}`, project: p.name, due: p.dueDate })),
  ].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")).slice(0, 8);

  const projectsHeading = delivered.length && delivered.every((d) => d.done) ? "Projects delivered" : "Projects";
  const owner = (opts.ownerName ?? "").trim();
  return {
    title: `Work Summary${owner ? `: ${owner}` : ""}, ${period.label}`,
    prepared: opts.today ?? todayISO(),
    period,
    single: projects.length === 1 ? { name: projects[0].name, type: PROJECT_TYPES[projects[0].type].label } : null,
    highlights,
    totals,
    results,
    otherResults,
    delivered,
    projectsHeading,
    capability: capabilityEntries.map(line).filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i),
    recognition,
    challenges,
    tasks,
    nextPriorities,
    changes: dedupe(changes),
    empty: !entries.length && !measurements.length && !tasksDone.length,
  };
}

function dedupe(changes) {
  const seen = new Set();
  return changes.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));
}

function latest(store, projectId) {
  return store.latestMeasurement(projectId);
}

// ---- Plain text (copy into email, Teams or an HR form) -----------------------

export function summaryToText(s) {
  const out = [s.title, `Prepared: ${fmtDate(s.prepared)}`, ""];
  const sec = (title, lines) => { if (lines.length) out.push(title, ...lines, ""); };
  const item = (x) => `• ${x.text}${x.project && !s.single ? ` (${x.project})` : ""}`;
  sec("Highlights", s.highlights.map(item));
  if (s.totals.length) out.push("By the numbers", s.totals.join(" · "), "");
  for (const g of s.results) sec(`Results: ${g.impact}`, g.items.map(item));
  sec("Other results", s.otherResults.map(item));
  sec(s.projectsHeading, s.delivered.map((p) => `• ${p.type} · ${p.name} · ${p.stage}${p.metric ? ` · ${p.metric}` : ""}`));
  sec("Capability built", s.capability.map(item));
  sec("Recognition", s.recognition.map((r) => `• "${r.quote}"${r.from ? ` (${r.from}, ${fmtDate(r.date)})` : ` (${fmtDate(r.date)})`}`));
  sec("Tasks completed", s.tasks.map((t) => `• ${t.text}${s.single ? "" : ` (${t.project})`}`));
  sec("Challenges handled", s.challenges.map((c) => `• Challenge: ${c.challenge}${c.lesson ? `  Lesson: ${c.lesson}` : ""}`));
  sec("Next priorities", s.nextPriorities.map((n) => `• ${n.text}${s.single ? "" : ` (${n.project})`}${n.due ? `, due ${fmtDate(n.due)}` : ""}`));
  return out.join("\n").trimEnd() + "\n";
}

// ---- CSV of raw log entries (spec 8; checklist item 8) -----------------------

export function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheets must not run it as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function entriesToCsv(store, { period, projectIds = null }) {
  const projects = new Map(store.list("projects").map((p) => [p.id, p]));
  const rows = store.list("log", (e) => (!projectIds || projectIds.includes(e.projectId)) && e.date >= period.from && e.date <= period.to)
    .sort((a, b) => a.date.localeCompare(b.date));
  const head = ["Date", "Project", "Project type", "Entry type", "Text", "Lesson", "Impact", "Amount", "Unit", "Highlight", "From"];
  const lines = [head.map(csvCell).join(",")];
  for (const e of rows) {
    const p = projects.get(e.projectId);
    lines.push([e.date, p?.name, p ? PROJECT_TYPES[p.type].label : "", e.type, e.text, e.lesson, e.impact.join("; "), e.impactValue, e.impactUnit, e.starred ? "yes" : "", e.from].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

// ---- Copy for Claude (spec 10): entries plus a ready-made prompt -------------

export const CLAUDE_PROMPT = "Write a confident, factual self-assessment for my performance review from these entries. Lead with results and numbers. Do not add anything that isn't in them.";

export function claudePrompt(store, { period, projectIds = null, type = null, includeChallenges = false }) {
  const projects = new Map(store.list("projects").map((p) => [p.id, p]));
  const ok = (p) => p && (!projectIds || projectIds.includes(p.id)) && (!type || p.type === type);
  const rows = store.list("log", (e) => ok(projects.get(e.projectId)) && e.date >= period.from && e.date <= period.to && (includeChallenges || e.type !== "failure"))
    .sort((a, b) => a.date.localeCompare(b.date));
  const lines = rows.map((e) => {
    const p = projects.get(e.projectId);
    const extra = [e.impact.length ? `improved: ${e.impact.join(", ")}` : "", e.impactValue !== null ? `${trimNum(e.impactValue)} ${e.impactUnit}`.trim() : "", e.lesson ? `lesson: ${e.lesson}` : "", e.from ? `from: ${e.from}` : "", e.starred ? "highlight" : ""].filter(Boolean).join("; ");
    return `- ${e.date} | ${p.name} (${PROJECT_TYPES[p.type].label}) | ${e.type} | ${e.text.trim()}${extra ? ` [${extra}]` : ""}`;
  });
  return `${CLAUDE_PROMPT}\n\nPeriod: ${period.label}\n\nEntries:\n${lines.join("\n") || "(none)"}\n`;
}
