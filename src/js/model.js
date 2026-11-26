// Data model: constants, limits and validation (spec sections 3 and 5).
// Pure functions only, so everything here runs under `node --test`.

export const SCHEMA_VERSION = 1;

export const LIMITS = Object.freeze({
  projectName: 120,
  logText: 2000,
  tagsPerProject: 10,
  tagLength: 40,
  shortText: 200,
  description: 2000,
});

export const STATUSES = ["Planned", "Active", "On hold", "Done"];
export const PRIORITIES = ["High", "Normal", "Low"];
export const LOG_TYPES = ["success", "failure", "note", "blocker", "decision", "recognition"];
export const LOG_TYPE_LABELS = {
  success: "Success",
  failure: "Failure",
  note: "Note",
  blocker: "Blocker",
  decision: "Decision",
  recognition: "Recognition",
};
export const IMPACTS = ["time", "cost", "quality", "safety", "delivery", "capability", "helped others"];

// Each type adds its own fields and its own stage track (spec 3.1).
export const PROJECT_TYPES = {
  fto: {
    label: "First-time order",
    fields: [
      { key: "customer", label: "Customer" },
      { key: "partNumbers", label: "Part number(s)", list: true },
      { key: "orderNo", label: "Order or PO number" },
      { key: "quantity", label: "Quantity", number: true },
      { key: "shipDate", label: "Ship date", date: true },
    ],
    stages: ["Order review", "Programming", "Tooling and fixturing", "First article inspection", "Production run", "Shipped"],
  },
  ci: {
    label: "Continuous improvement",
    fields: [
      { key: "scope", label: "Scope", options: ["Single part", "Product family"] },
      { key: "partOrFamily", label: "Part number or family name" },
      { key: "metric", label: "Metric (e.g. setup time)" },
      { key: "unit", label: "Unit (e.g. min)" },
      { key: "baseline", label: "Baseline", number: true },
      { key: "target", label: "Target", number: true },
    ],
    stages: ["Identify", "Measure baseline", "Trial", "Implement", "Verify and sustain"],
  },
  auto: {
    label: "Automation or technology",
    fields: [
      { key: "system", label: "System or equipment" },
      { key: "vendor", label: "Vendor" },
      { key: "location", label: "Cell or location" },
      { key: "expectedBenefit", label: "Expected benefit" },
    ],
    stages: ["Proposal", "Approval", "Install", "Validate", "Hand off to production"],
  },
  other: { label: "Other", fields: [], stages: [] },
};

export const DEFAULT_SETTINGS = Object.freeze({
  palette: "A",
  mode: "auto",
  exportIncludeFailures: false,
  exportDefaultRange: "quarter",
  lastReviewDate: null,
  weeklyNudge: false,
  autoLogStage: true,
  autoLogTasks: true,
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function newId() {
  return globalThis.crypto.randomUUID();
}

export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function str(v, max) {
  if (v === undefined || v === null) return "";
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

function dateOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  return DATE_RE.test(String(v)) ? String(v) : undefined; // undefined = invalid
}

function numOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Each normalize* returns { value, errors }. `value` is safe to store;
// `errors` lists problems a form should show. Data arriving from disk or
// (later) another device goes through the same functions (checklist item 7).

export function normalizeProject(input) {
  const errors = [];
  const type = Object.hasOwn(PROJECT_TYPES, input.type) ? input.type : "other";
  const name = str(input.name, LIMITS.projectName);
  if (!name) errors.push("Name is required.");
  if (String(input.name ?? "").trim().length > LIMITS.projectName) errors.push(`Name is limited to ${LIMITS.projectName} characters.`);

  const tags = [...new Set((Array.isArray(input.tags) ? input.tags : [])
    .map((t) => str(t, LIMITS.tagLength)).filter(Boolean))];
  if (tags.length > LIMITS.tagsPerProject) errors.push(`Up to ${LIMITS.tagsPerProject} tags per project.`);

  const value = {
    name,
    description: str(input.description, LIMITS.description),
    type,
    stage: 0,
    status: STATUSES.includes(input.status) ? input.status : "Active",
    priority: PRIORITIES.includes(input.priority) ? input.priority : "Normal",
    startDate: null,
    dueDate: null,
    tags: tags.slice(0, LIMITS.tagsPerProject),
    archived: input.archived === true,
    sortOrder: Number.isFinite(input.sortOrder) ? input.sortOrder : 0,
    owners: Array.isArray(input.owners) ? input.owners.map((o) => str(o, 64)).filter(Boolean) : [],
    team: Array.isArray(input.team) ? input.team.map((o) => str(o, 64)).filter(Boolean) : [],
  };

  const stages = PROJECT_TYPES[type].stages;
  const stage = Number(input.stage ?? 0);
  value.stage = Number.isInteger(stage) && stage >= 0 && stage < Math.max(stages.length, 1) ? stage : 0;

  for (const key of ["startDate", "dueDate"]) {
    const d = dateOrNull(input[key]);
    if (d === undefined) errors.push(`${key === "startDate" ? "Start" : "Due"} date must be YYYY-MM-DD.`);
    else value[key] = d;
  }
  if (value.startDate && value.dueDate && value.dueDate < value.startDate) errors.push("Due date is before the start date.");

  for (const f of PROJECT_TYPES[type].fields) {
    const raw = input[f.key];
    if (f.list) {
      const list = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
      value[f.key] = list.map((x) => str(x, LIMITS.shortText)).filter(Boolean).slice(0, 50);
    } else if (f.number) {
      const n = numOrNull(raw);
      if (n === undefined) { errors.push(`${f.label} must be a number.`); value[f.key] = null; }
      else value[f.key] = n;
    } else if (f.date) {
      const d = dateOrNull(raw);
      if (d === undefined) { errors.push(`${f.label} must be YYYY-MM-DD.`); value[f.key] = null; }
      else value[f.key] = d;
    } else if (f.options) {
      value[f.key] = f.options.includes(raw) ? raw : f.options[0];
    } else {
      value[f.key] = str(raw, LIMITS.shortText);
    }
  }
  return { value, errors };
}

export function normalizeTask(input) {
  const errors = [];
  const title = str(input.title, LIMITS.shortText);
  if (!title) errors.push("Task title is required.");
  if (!input.projectId) errors.push("Task needs a project.");
  const due = dateOrNull(input.dueDate);
  if (due === undefined) errors.push("Due date must be YYYY-MM-DD.");
  return {
    value: {
      projectId: str(input.projectId, 64),
      title,
      dueDate: due ?? null,
      done: input.done === true,
      doneAt: typeof input.doneAt === "string" ? input.doneAt.slice(0, 40) : null,
      sortOrder: Number.isFinite(input.sortOrder) ? input.sortOrder : 0,
      claimedBy: input.claimedBy ? str(input.claimedBy, 64) : null,
      claimedAt: typeof input.claimedAt === "string" ? input.claimedAt.slice(0, 40) : null,
      completedBy: input.completedBy ? str(input.completedBy, 64) : null,
    },
    errors,
  };
}

export function normalizeLogEntry(input) {
  const errors = [];
  const text = str(input.text, LIMITS.logText);
  if (!text) errors.push("Entry text is required.");
  if (String(input.text ?? "").trim().length > LIMITS.logText) errors.push(`Entries are limited to ${LIMITS.logText} characters.`);
  if (!input.projectId) errors.push("Entry needs a project.");
  const date = dateOrNull(input.date);
  if (date === undefined) errors.push("Date must be YYYY-MM-DD.");
  const impactValue = numOrNull(input.impactValue);
  if (impactValue === undefined) errors.push("Impact value must be a number.");
  const type = LOG_TYPES.includes(input.type) ? input.type : "note";
  return {
    value: {
      projectId: str(input.projectId, 64),
      authorId: input.authorId ? str(input.authorId, 64) : null,
      visibility: input.visibility === "shared" ? "shared" : "private", // "only me" by default
      type,
      text,
      lesson: str(input.lesson, LIMITS.shortText * 2),
      date: date ?? todayISO(),
      source: input.source === "voice" ? "voice" : "typed",
      impact: (Array.isArray(input.impact) ? input.impact : []).filter((i) => IMPACTS.includes(i)),
      impactValue: impactValue ?? null,
      impactUnit: str(input.impactUnit, 40),
      starred: input.starred === true,
      from: str(input.from, LIMITS.shortText),
      resolved: type === "blocker" ? input.resolved === true : false,
    },
    errors,
  };
}

export function normalizeMeasurement(input) {
  const errors = [];
  const value = numOrNull(input.value);
  if (value === null || value === undefined) errors.push("Measurement must be a number.");
  const date = dateOrNull(input.date);
  if (date === undefined) errors.push("Date must be YYYY-MM-DD.");
  return {
    value: {
      projectId: str(input.projectId, 64),
      date: date ?? todayISO(),
      value: value ?? 0,
      note: str(input.note, LIMITS.shortText),
    },
    errors,
  };
}

export function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS };
  if (["A", "B", "C"].includes(input.palette)) s.palette = input.palette;
  if (["light", "dark", "auto"].includes(input.mode)) s.mode = input.mode;
  for (const k of ["exportIncludeFailures", "weeklyNudge", "autoLogStage", "autoLogTasks"]) {
    if (typeof input[k] === "boolean") s[k] = input[k];
  }
  if (["month", "quarter", "year", "review"].includes(input.exportDefaultRange)) s.exportDefaultRange = input.exportDefaultRange;
  const d = dateOrNull(input.lastReviewDate);
  if (d) s.lastReviewDate = d;
  return { value: s, errors: [] };
}

// Sync group member list (spec 5, devices). A device's id is its device id;
// publicKey is its Noise identity key (32 bytes, base64).
export const DEVICE_KINDS = ["phone", "computer", "tablet", "kiosk"];
export const DEVICE_ROLES = ["full", "view-only"];
const PUBKEY_RE = /^[A-Za-z0-9+/]{43}=$/;

export function normalizeDevice(input) {
  const errors = [];
  const name = str(input.name, 40);
  if (!name) errors.push("Device name is required.");
  const publicKey = String(input.publicKey ?? "");
  if (!PUBKEY_RE.test(publicKey)) errors.push("Device key is missing or invalid.");
  return {
    value: {
      name,
      kind: DEVICE_KINDS.includes(input.kind) ? input.kind : "computer",
      role: DEVICE_ROLES.includes(input.role) ? input.role : "full",
      kioskMode: input.kioskMode === true,
      publicKey,
      addedBy: input.addedBy ? str(input.addedBy, 64) : null,
    },
    errors,
  };
}

export const NORMALIZERS = {
  projects: normalizeProject,
  tasks: normalizeTask,
  log: normalizeLogEntry,
  measurements: normalizeMeasurement,
  devices: normalizeDevice,
};

// "Setup time 42 min to 28 min, down 33%, target 25 min"
export function describeChange(project, current) {
  const { baseline, target, metric, unit } = project;
  if (baseline === null || baseline === undefined || current === null || current === undefined) return "";
  const u = unit ? ` ${unit}` : "";
  const label = metric ? `${metric[0].toUpperCase()}${metric.slice(1)} ` : "";
  let text = `${label}${fmt(baseline)}${u} to ${fmt(current)}${u}`;
  if (baseline !== 0) {
    const pct = Math.round(((current - baseline) / Math.abs(baseline)) * 100);
    if (pct !== 0) text += `, ${pct < 0 ? "down" : "up"} ${Math.abs(pct)}%`;
    else text += ", no change";
  }
  if (target !== null && target !== undefined) text += `, target ${fmt(target)}${u}`;
  return text;
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
