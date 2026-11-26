// In-memory store with tombstoned deletes (spec section 5).
//
// Records are kept per collection, keyed by id. A delete keeps the record as
// a tombstone ({ deleted: true }) so that, once sync arrives in phase 2, a
// deleted item stays deleted on every device. The shape maps one-to-one onto
// the CRDT document planned for phase 2 (one map per collection).

import {
  SCHEMA_VERSION, NORMALIZERS, normalizeSettings, newId, todayISO, PROJECT_TYPES,
} from "./model.js";

export const COLLECTIONS = ["projects", "tasks", "log", "measurements"];
const MAX_RECORDS_PER_COLLECTION = 50000;

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.join(" "));
    this.errors = errors;
  }
}

export function createStore({ deviceId, now = () => new Date() } = {}) {
  if (!deviceId) throw new Error("deviceId is required");
  const data = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
  let settings = normalizeSettings().value;
  const listeners = new Set();

  const stamp = () => now().toISOString();
  const emit = () => { for (const fn of listeners) fn(); };

  function meta(existing) {
    const t = stamp();
    return {
      id: existing?.id ?? newId(),
      createdAt: existing?.createdAt ?? t,
      updatedAt: t,
      deviceId,
      schemaVersion: SCHEMA_VERSION,
    };
  }

  function assertCollection(c) {
    if (!COLLECTIONS.includes(c)) throw new Error(`Unknown collection: ${c}`);
  }

  const store = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    get(c, id) {
      assertCollection(c);
      const r = data[c].get(id);
      return r && !r.deleted ? r : undefined;
    },

    list(c, filter = () => true) {
      assertCollection(c);
      return [...data[c].values()].filter((r) => !r.deleted && filter(r));
    },

    create(c, fields) {
      assertCollection(c);
      const { value, errors } = NORMALIZERS[c](fields);
      if (errors.length) throw new ValidationError(errors);
      if (data[c].size >= MAX_RECORDS_PER_COLLECTION) throw new ValidationError(["Storage limit reached."]);
      const record = { ...value, ...meta() };
      data[c].set(record.id, record);
      emit();
      return record;
    },

    update(c, id, patch) {
      const existing = store.get(c, id);
      if (!existing) throw new Error("Record not found");
      const { value, errors } = NORMALIZERS[c]({ ...existing, ...patch });
      if (errors.length) throw new ValidationError(errors);
      const record = { ...value, ...meta(existing) };
      data[c].set(id, record);
      emit();
      return record;
    },

    remove(c, id) {
      const existing = store.get(c, id);
      if (!existing) return;
      data[c].set(id, { id, deleted: true, ...meta(existing) });
      if (c === "projects") {
        // Child records go with their project.
        for (const child of ["tasks", "log", "measurements"]) {
          for (const r of store.list(child, (x) => x.projectId === id)) {
            data[child].set(r.id, { id: r.id, deleted: true, ...meta(r) });
          }
        }
      }
      emit();
    },

    getSettings() { return { ...settings }; },

    updateSettings(patch) {
      settings = normalizeSettings({ ...settings, ...patch }).value;
      emit();
      return settings;
    },

    // ---- Domain helpers -------------------------------------------------

    advanceStage(projectId, direction = 1) {
      const p = store.get("projects", projectId);
      const stages = PROJECT_TYPES[p.type].stages;
      const next = p.stage + direction;
      if (next < 0 || next >= stages.length) return p;
      const updated = store.update("projects", projectId, { stage: next });
      if (direction > 0 && settings.autoLogStage) {
        store.create("log", { projectId, type: "success", text: `Reached ${stages[next]}`, date: todayISO(now()) });
      }
      return updated;
    },

    setTaskDone(taskId, done) {
      const t = store.get("tasks", taskId);
      const updated = store.update("tasks", taskId, { done, doneAt: done ? stamp() : null });
      if (done && !t.done && settings.autoLogTasks) {
        store.create("log", { projectId: t.projectId, type: "success", text: `Completed: ${t.title}`, date: todayISO(now()) });
      }
      return updated;
    },

    latestMeasurement(projectId) {
      const ms = store.list("measurements", (m) => m.projectId === projectId);
      ms.sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)));
      return ms.at(-1);
    },

    // ---- Persistence ----------------------------------------------------

    serialize() {
      return JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        settings,
        ...Object.fromEntries(COLLECTIONS.map((c) => [c, [...data[c].values()]])),
      });
    },

    // Loads a saved document. Everything is re-validated, because the file
    // on disk (and later, data from another device) is treated as untrusted.
    // Returns the number of records that were dropped as invalid.
    load(json) {
      let doc;
      try { doc = JSON.parse(json); } catch { throw new Error("Saved data is not valid JSON"); }
      if (!doc || typeof doc !== "object") throw new Error("Saved data has the wrong shape");
      if (Number(doc.schemaVersion) > SCHEMA_VERSION) {
        throw new Error("Saved data is from a newer version of the app. Update the app to open it.");
      }
      let dropped = 0;
      for (const c of COLLECTIONS) {
        data[c].clear();
        const rows = Array.isArray(doc[c]) ? doc[c].slice(0, MAX_RECORDS_PER_COLLECTION) : [];
        for (const r of rows) {
          if (!r || typeof r.id !== "string" || r.id.length > 64) { dropped++; continue; }
          const m = {
            id: r.id,
            createdAt: typeof r.createdAt === "string" ? r.createdAt.slice(0, 40) : stamp(),
            updatedAt: typeof r.updatedAt === "string" ? r.updatedAt.slice(0, 40) : stamp(),
            deviceId: typeof r.deviceId === "string" ? r.deviceId.slice(0, 64) : deviceId,
            schemaVersion: SCHEMA_VERSION,
          };
          if (r.deleted === true) { data[c].set(r.id, { ...m, deleted: true }); continue; }
          const { value, errors } = NORMALIZERS[c](r);
          if (errors.length) { dropped++; continue; }
          data[c].set(r.id, { ...value, ...m });
        }
      }
      settings = normalizeSettings(doc.settings).value;
      emit();
      return dropped;
    },
  };
  return store;
}

// ---- Dashboard figures (spec 3.4) ---------------------------------------

export function dashboardStats(store, today = todayISO()) {
  const live = store.list("projects", (p) => !p.archived);
  const weekEnd = addDays(today, 7);
  const open = live.filter((p) => p.status !== "Done");
  const projectName = (id) => store.get("projects", id)?.name ?? "";

  const dueItems = [
    ...open.filter((p) => p.dueDate).map((p) => ({ kind: "project", id: p.id, projectId: p.id, title: p.name, dueDate: p.dueDate })),
    ...store.list("tasks", (t) => !t.done && t.dueDate && open.some((p) => p.id === t.projectId))
      .map((t) => ({ kind: "task", id: t.id, projectId: t.projectId, title: t.title, project: projectName(t.projectId), dueDate: t.dueDate })),
  ];

  return {
    active: live.filter((p) => p.status === "Active").length,
    onHold: live.filter((p) => p.status === "On hold").length,
    dueThisWeek: open.filter((p) => p.dueDate && p.dueDate >= today && p.dueDate <= weekEnd).length,
    overdue: open.filter((p) => p.dueDate && p.dueDate < today).length,
    dueSoon: dueItems.filter((d) => d.dueDate <= addDays(today, 14))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8),
    recentWins: store.list("log", (e) => e.type === "success")
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 5)
      .map((e) => ({ ...e, project: projectName(e.projectId) })),
    openBlockers: store.list("log", (e) => e.type === "blocker" && !e.resolved)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => ({ ...e, project: projectName(e.projectId) })),
  };
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
