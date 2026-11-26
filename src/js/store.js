// Record store with per-field edit stamps, built for direct sync (spec 5, 6).
//
// Every field of every record carries the stamp of its last edit (see
// clock.js). Merging two copies keeps, field by field, the value with the
// later stamp, so edits made on different devices while apart combine
// without "which copy wins" prompts and every device ends up identical, in
// whatever order changes arrive. A delete leaves a tombstone that beats any
// edit, so a deleted item stays deleted everywhere.
//
// Everything arriving from disk or another device is re-validated.

import {
  SCHEMA_VERSION, NORMALIZERS, normalizeSettings, newId, todayISO, PROJECT_TYPES,
} from "./model.js";
import { createClock, parseStamp, legacyStamp, formatStamp } from "./clock.js";

export const COLLECTIONS = ["projects", "tasks", "log", "measurements"];
const MAX_RECORDS_PER_COLLECTION = 50000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.join(" "));
    this.errors = errors;
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isoOf = (stamp) => new Date(parseStamp(stamp)?.t ?? 0).toISOString();

export function createStore({ deviceId, now = () => new Date() } = {}) {
  if (!parseStamp(`0000000000000-00000-${deviceId}`)) throw new Error("deviceId must be a UUID");
  const clock = createClock(deviceId, () => now().getTime());
  const data = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
  let settings = normalizeSettings().value;
  let settingsClocks = {};
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };

  function assertCollection(c) {
    if (!COLLECTIONS.includes(c)) throw new Error(`Unknown collection: ${c}`);
  }

  // Derived metadata: when the record was last changed, and by which device.
  function finish(id, value, clocks, createdAt) {
    const latest = Object.values(clocks).sort().at(-1);
    return {
      ...value,
      id,
      createdAt,
      updatedAt: isoOf(latest),
      deviceId: parseStamp(latest)?.device ?? deviceId,
      schemaVersion: SCHEMA_VERSION,
      _c: clocks,
    };
  }

  function tombstone(id, stamp, createdAt) {
    return { id, deleted: true, _d: stamp, createdAt, updatedAt: isoOf(stamp), deviceId: parseStamp(stamp).device, schemaVersion: SCHEMA_VERSION };
  }

  function valueKeys(c, value) {
    return Object.keys(value).filter((k) => !["id", "createdAt", "updatedAt", "deviceId", "schemaVersion", "_c", "_d", "deleted"].includes(k));
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
      const s = clock.tick();
      const clocks = Object.fromEntries(valueKeys(c, value).map((k) => [k, s]));
      const record = finish(newId(), value, clocks, isoOf(s));
      data[c].set(record.id, record);
      emit();
      return record;
    },

    update(c, id, patch) {
      const existing = store.get(c, id);
      if (!existing) throw new Error("Record not found");
      const { value, errors } = NORMALIZERS[c]({ ...existing, ...patch });
      if (errors.length) throw new ValidationError(errors);
      const s = clock.tick();
      const clocks = {};
      for (const k of valueKeys(c, value)) {
        clocks[k] = existing._c[k] && same(existing[k], value[k]) ? existing._c[k] : s;
      }
      const record = finish(id, value, clocks, existing.createdAt);
      data[c].set(id, record);
      emit();
      return record;
    },

    remove(c, id) {
      const existing = store.get(c, id);
      if (!existing) return;
      const s = clock.tick();
      data[c].set(id, tombstone(id, s, existing.createdAt));
      if (c === "projects") {
        // Child records go with their project.
        for (const child of ["tasks", "log", "measurements"]) {
          for (const r of store.list(child, (x) => x.projectId === id)) {
            data[child].set(r.id, tombstone(r.id, s, r.createdAt));
          }
        }
      }
      emit();
    },

    getSettings() { return { ...settings }; },

    updateSettings(patch) {
      const next = normalizeSettings({ ...settings, ...patch }).value;
      const s = clock.tick();
      for (const k of Object.keys(next)) if (!same(next[k], settings[k]) || !settingsClocks[k]) settingsClocks[k] = s;
      settings = next;
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
      const updated = store.update("tasks", taskId, { done, doneAt: done ? now().toISOString() : null });
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

    // ---- Sync -----------------------------------------------------------

    /** For each device, the latest edit stamp from it that this copy holds. */
    versionVector() {
      const vv = {};
      const see = (s) => { const p = parseStamp(s); if (p && (!vv[p.device] || s > vv[p.device])) vv[p.device] = s; };
      for (const c of COLLECTIONS) {
        for (const r of data[c].values()) {
          if (r.deleted) see(r._d); else Object.values(r._c).forEach(see);
        }
      }
      Object.values(settingsClocks).forEach(see);
      return vv;
    },

    /**
     * Everything another device is missing, given its version vector: only
     * the fields edited after the stamps it already has. ({} = everything.)
     */
    changesSince(vv = {}) {
      const newer = (s) => { const p = parseStamp(s); return p && (!vv[p.device] || s > vv[p.device]); };
      const out = { schemaVersion: SCHEMA_VERSION, settings: { _c: {} } };
      for (const c of COLLECTIONS) {
        out[c] = [];
        for (const r of data[c].values()) {
          if (r.deleted) {
            if (newer(r._d)) out[c].push({ id: r.id, deleted: true, _d: r._d, createdAt: r.createdAt });
            continue;
          }
          const row = { id: r.id, createdAt: r.createdAt, _c: {} };
          for (const [k, s] of Object.entries(r._c)) if (newer(s)) { row[k] = r[k]; row._c[k] = s; }
          if (Object.keys(row._c).length) out[c].push(row);
        }
      }
      for (const [k, s] of Object.entries(settingsClocks)) if (newer(s)) { out.settings[k] = settings[k]; out.settings._c[k] = s; }
      return out;
    },

    /**
     * Merges changes from another device (or a saved file). Untrusted:
     * every record is re-validated, unknown fields are ignored, and stamps
     * implausibly far in the future are rejected. Returns counts.
     */
    merge(changes, { silent = false } = {}) {
      if (!changes || typeof changes !== "object") throw new Error("Sync data has the wrong shape");
      if (Number(changes.schemaVersion) > SCHEMA_VERSION) throw new Error("The other device runs a newer version. Update this app first.");
      let applied = 0;
      let dropped = 0;
      for (const c of COLLECTIONS) {
        const rows = Array.isArray(changes[c]) ? changes[c].slice(0, MAX_RECORDS_PER_COLLECTION) : [];
        for (const row of rows) {
          if (!row || typeof row !== "object" || typeof row.id !== "string" || !ID_RE.test(row.id)) { dropped++; continue; }
          const existing = data[c].get(row.id);
          const createdAt = existing?.createdAt ?? (typeof row.createdAt === "string" && !Number.isNaN(Date.parse(row.createdAt)) ? new Date(row.createdAt).toISOString() : isoOf(clock.tick()));
          if (row.deleted === true) {
            if (!clock.acceptable(row._d)) { dropped++; continue; }
            clock.observe(row._d);
            if (!existing?.deleted || row._d > existing._d) { data[c].set(row.id, tombstone(row.id, row._d, createdAt)); applied++; }
            continue;
          }
          if (existing?.deleted) continue; // deletes win
          if (!row._c || typeof row._c !== "object") { dropped++; continue; }
          const candidate = existing ? { ...existing } : {};
          const clocks = existing ? { ...existing._c } : {};
          let changed = false;
          let rejected = false;
          for (const [k, s] of Object.entries(row._c)) {
            if (!Object.hasOwn(row, k) || k === "id" || k.startsWith("_")) continue;
            if (!clock.acceptable(s)) { rejected = true; continue; }
            clock.observe(s);
            if (!clocks[k] || s > clocks[k]) { candidate[k] = row[k]; clocks[k] = s; changed = true; }
          }
          if (!changed) { if (rejected && !existing) dropped++; continue; }
          const { value, errors } = NORMALIZERS[c](candidate);
          if (!existing && errors.length) { dropped++; continue; }
          const keep = Object.fromEntries(valueKeys(c, value).filter((k) => clocks[k]).map((k) => [k, clocks[k]]));
          if (!Object.keys(keep).length) { dropped++; continue; }
          data[c].set(row.id, finish(row.id, value, keep, createdAt));
          applied++;
        }
      }
      if (changes.settings && typeof changes.settings === "object" && changes.settings._c && typeof changes.settings._c === "object") {
        const cand = { ...settings };
        let changed = false;
        for (const [k, s] of Object.entries(changes.settings._c)) {
          if (!Object.hasOwn(settings, k) || !clock.acceptable(s)) continue;
          clock.observe(s);
          if (!settingsClocks[k] || s > settingsClocks[k]) { cand[k] = changes.settings[k]; settingsClocks[k] = s; changed = true; }
        }
        if (changed) { settings = normalizeSettings(cand).value; applied++; }
      }
      if (applied && !silent) emit();
      return { applied, dropped };
    },

    // ---- Persistence ----------------------------------------------------

    serialize() {
      return JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        settings: { ...settings, _c: settingsClocks },
        ...Object.fromEntries(COLLECTIONS.map((c) => [c, [...data[c].values()]])),
      });
    },

    // Loads a saved document. Everything is re-validated, because the file
    // on disk is treated as untrusted. Files from before edit stamps existed
    // get stamps derived from their updatedAt times. Returns the number of
    // records dropped as invalid.
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
          if (!r || typeof r.id !== "string" || !ID_RE.test(r.id)) { dropped++; continue; }
          const origin = parseStamp(`0000000000000-00000-${r.deviceId}`) ? String(r.deviceId).toLowerCase() : deviceId;
          const fallback = legacyStamp(r.updatedAt, origin);
          const createdAt = typeof r.createdAt === "string" && !Number.isNaN(Date.parse(r.createdAt)) ? new Date(r.createdAt).toISOString() : isoOf(fallback);
          if (r.deleted === true) {
            const s = clock.acceptable(r._d) ? r._d : fallback;
            clock.observe(s);
            data[c].set(r.id, tombstone(r.id, s, createdAt));
            continue;
          }
          const { value, errors } = NORMALIZERS[c](r);
          if (errors.length) { dropped++; continue; }
          const clocks = {};
          for (const k of valueKeys(c, value)) {
            const s = r._c && clock.acceptable(r._c[k]) ? r._c[k] : fallback;
            clocks[k] = s;
            clock.observe(s);
          }
          data[c].set(r.id, finish(r.id, value, clocks, createdAt));
        }
      }
      settings = normalizeSettings(doc.settings).value;
      settingsClocks = {};
      const sc = doc.settings?._c;
      // Settings saved before stamps existed get the oldest possible stamp:
      // they still reach a new device, but any real edit beats them.
      const oldest = formatStamp(1, 0, deviceId);
      for (const k of Object.keys(settings)) {
        if (sc && clock.acceptable(sc[k])) { settingsClocks[k] = sc[k]; clock.observe(sc[k]); }
        else if (doc.settings && Object.hasOwn(doc.settings, k)) settingsClocks[k] = oldest;
      }
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
