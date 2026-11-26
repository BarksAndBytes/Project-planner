// Screens (spec section 4). Each view returns a DOM node; main.js routes.

import { h, fill, field, select, formData, formatDate } from "./dom.js";
import {
  PROJECT_TYPES, STATUSES, PRIORITIES, LOG_TYPES, LOG_TYPE_LABELS, IMPACTS, LIMITS,
  todayISO, describeChange,
} from "./model.js";
import { dashboardStats, ValidationError } from "./store.js";
import { PALETTES, TYPE_TOKEN } from "./themes.js";

// ---- Shared bits ---------------------------------------------------------

function typeTag(type) {
  return h("span", { class: "tag", style: { background: `var(--${TYPE_TOKEN[type]})` } }, LOG_TYPE_LABELS[type]);
}

function errorBox() {
  return h("div", { class: "errors", role: "alert", hidden: true });
}

function showErrors(box, err) {
  fill(box, ...(err instanceof ValidationError ? err.errors : [err.message]).map((e) => h("div", {}, e)));
  box.hidden = false;
}

function stageTrack(project) {
  const stages = PROJECT_TYPES[project.type].stages;
  if (!stages.length) return null;
  return h("ol", { class: "stages", "aria-label": "Stage track" },
    stages.map((s, i) => h("li", {
      class: i < project.stage ? "done" : i === project.stage ? "current" : "",
      title: s,
      "aria-current": i === project.stage ? "step" : undefined,
    }, h("span", { class: "sr" }, s))));
}

function progress(store, projectId) {
  const tasks = store.list("tasks", (t) => t.projectId === projectId);
  const done = tasks.filter((t) => t.done).length;
  return { done, total: tasks.length, pct: tasks.length ? done / tasks.length : 0 };
}

function empty(text, action) {
  return h("div", { class: "empty" }, h("p", {}, text), action ?? null);
}

// ---- Dashboard -----------------------------------------------------------

export function dashboardView(store, { openQuickLog }) {
  const s = dashboardStats(store, todayISO());
  const kpi = (n, label, warn) => h("div", { class: `kpi${warn && n ? " warn" : ""}` }, h("div", { class: "n" }, String(n)), h("div", { class: "t" }, label));

  return h("section", { class: "view" },
    h("div", { class: "kpis" },
      kpi(s.active, "Active"), kpi(s.onHold, "On hold"), kpi(s.dueThisWeek, "Due this week"), kpi(s.overdue, "Overdue", true)),
    h("button", { class: "quicklog", onclick: () => openQuickLog() }, "Quick log"),
    h("div", { class: "grid2" },
      h("div", { class: "card" }, h("h2", {}, "Due soon"),
        s.dueSoon.length ? h("ul", { class: "rows" }, s.dueSoon.map((d) => h("li", {},
          h("a", { href: `#/project/${d.projectId}${d.kind === "task" ? "/tasks" : ""}` }, d.title),
          d.kind === "task" ? h("small", { class: "muted" }, ` · ${d.project}`) : null,
          h("span", { class: `date${d.dueDate < todayISO() ? " overdue" : ""}` }, formatDate(d.dueDate))))) : empty("Nothing due in the next two weeks.")),
      h("div", { class: "card" }, h("h2", {}, "Recent wins"),
        s.recentWins.length ? h("ul", { class: "rows" }, s.recentWins.map((e) => h("li", {},
          h("span", { class: "dot", style: { background: "var(--ok)" } }),
          h("a", { href: `#/project/${e.projectId}/log` }, e.text),
          h("small", { class: "muted" }, ` · ${e.project}`)))) : empty("Log a success and it shows up here.")),
      h("div", { class: "card" }, h("h2", {}, "Open blockers"),
        s.openBlockers.length ? h("ul", { class: "rows" }, s.openBlockers.map((e) => h("li", {},
          h("span", { class: "dot", style: { background: "var(--block)" } }),
          h("a", { href: `#/project/${e.projectId}/log` }, e.text),
          h("small", { class: "muted" }, ` · ${e.project}`)))) : empty("No open blockers.")),
    ));
}

// ---- Projects list --------------------------------------------------------

export function projectsView(store, state) {
  const q = (state.q ?? "").toLowerCase();
  const projects = store.list("projects", (p) =>
    (state.showArchived ? p.archived : !p.archived) &&
    (!state.status || p.status === state.status) &&
    (!state.type || p.type === state.type) &&
    (!q || p.name.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q))))
    .sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.name.localeCompare(b.name));

  const rerender = () => state.rerender();
  const search = h("input", { type: "search", placeholder: "Search name or tag", value: state.q ?? "", "aria-label": "Search projects" });
  search.addEventListener("input", () => { state.q = search.value; rerender(); });
  const statusSel = select("status", [["", "All statuses"], ...STATUSES], state.status ?? "");
  statusSel.addEventListener("change", () => { state.status = statusSel.value; rerender(); });
  const typeSel = select("type", [["", "All types"], ...Object.entries(PROJECT_TYPES).map(([k, t]) => [k, t.label])], state.type ?? "");
  typeSel.addEventListener("change", () => { state.type = typeSel.value; rerender(); });
  const arch = h("input", { type: "checkbox", checked: state.showArchived });
  arch.addEventListener("change", () => { state.showArchived = arch.checked; rerender(); });

  return h("section", { class: "view" },
    h("div", { class: "toolbar" },
      search, statusSel, typeSel,
      h("label", { class: "check" }, arch, " Archived"),
      h("a", { class: "btn primary", href: "#/new" }, "New project")),
    projects.length ? h("ul", { class: "cards" }, projects.map((p) => {
      const pr = progress(store, p.id);
      return h("li", {}, h("a", { class: "card project-card", href: `#/project/${p.id}` },
        h("div", { class: "pc-head" }, h("strong", {}, p.name),
          h("span", { class: `chip prio-${p.priority.toLowerCase()}` }, p.priority),
          h("span", { class: "chip" }, p.status)),
        h("div", { class: "muted small" }, PROJECT_TYPES[p.type].label,
          p.dueDate ? ` · due ${formatDate(p.dueDate)}` : "",
          PROJECT_TYPES[p.type].stages.length ? ` · ${PROJECT_TYPES[p.type].stages[p.stage]}` : ""),
        stageTrack(p),
        pr.total ? h("div", { class: "bar", "aria-label": `${pr.done} of ${pr.total} tasks done` }, h("i", { style: { width: `${pr.pct * 100}%` } })) : null,
        p.tags.length ? h("div", { class: "tags" }, p.tags.map((t) => h("span", { class: "chip" }, t))) : null));
    })) : empty(store.list("projects").length ? "No projects match." : "No projects yet.", h("a", { class: "btn primary", href: "#/new" }, "Create your first project")));
}

// ---- Project form ---------------------------------------------------------

export function projectFormView(store, { id, navigate }) {
  const existing = id ? store.get("projects", id) : null;
  const p = existing ?? { type: "fto", status: "Active", priority: "Normal", tags: [] };
  const errors = errorBox();
  const typeFields = h("div", { class: "type-fields" });

  const renderTypeFields = (type) => {
    fill(typeFields, ...PROJECT_TYPES[type].fields.map((f) => {
      const v = p[f.key];
      if (f.options) return field(f.label, select(f.key, f.options, v));
      return field(f.label, h("input", {
        name: f.key,
        type: f.number ? "number" : f.date ? "date" : "text",
        step: f.number ? "any" : undefined,
        value: Array.isArray(v) ? v.join(", ") : v ?? "",
        placeholder: f.list ? "Comma-separated" : undefined,
      }));
    }));
  };

  const typeSel = select("type", Object.entries(PROJECT_TYPES).map(([k, t]) => [k, t.label]), p.type);
  typeSel.addEventListener("change", () => renderTypeFields(typeSel.value));
  if (existing) typeSel.disabled = true; // changing type would orphan stage history
  renderTypeFields(p.type);

  const form = h("form", { class: "card form", novalidate: true },
    h("h2", {}, existing ? "Edit project" : "New project"),
    errors,
    field("Name", h("input", { name: "name", required: true, maxlength: LIMITS.projectName, value: p.name ?? "", autofocus: true })),
    field("Type", typeSel, existing ? "Type can't be changed after creation." : null),
    field("Short description", h("textarea", { name: "description", rows: 2, maxlength: LIMITS.description }, p.description ?? "")),
    h("div", { class: "row3" },
      field("Status", select("status", STATUSES, p.status)),
      field("Priority", select("priority", PRIORITIES, p.priority))),
    h("div", { class: "row3" },
      field("Start date", h("input", { name: "startDate", type: "date", value: p.startDate ?? "" })),
      field("Due date", h("input", { name: "dueDate", type: "date", value: p.dueDate ?? "" }))),
    field("Tags", h("input", { name: "tags", value: (p.tags ?? []).join(", ") }), `Comma-separated, up to ${LIMITS.tagsPerProject}.`),
    typeFields,
    h("div", { class: "actions" },
      h("a", { class: "btn", href: existing ? `#/project/${existing.id}` : "#/projects" }, "Cancel"),
      h("button", { class: "btn primary", type: "submit" }, existing ? "Save" : "Create project")));

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const data = formData(form);
    if (existing) data.type = existing.type;
    data.tags = String(data.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    try {
      const saved = existing ? store.update("projects", existing.id, data) : store.create("projects", data);
      navigate(`#/project/${saved.id}`);
    } catch (err) { showErrors(errors, err); }
  });
  return h("section", { class: "view narrow" }, form);
}

// ---- Project detail -------------------------------------------------------

export function projectView(store, { id, tab = "overview", navigate, openQuickLog, confirm }) {
  const p = store.get("projects", id);
  if (!p) return empty("That project no longer exists.", h("a", { class: "btn", href: "#/projects" }, "Back to projects"));
  const stages = PROJECT_TYPES[p.type].stages;
  const tabs = [["overview", "Overview"], ["tasks", "Tasks"], ["log", "Log"]];

  const header = h("div", { class: "detail-head" },
    h("div", {},
      h("h1", {}, p.name),
      h("div", { class: "muted small" }, PROJECT_TYPES[p.type].label, " · ", p.status, " · ", p.priority, " priority",
        p.archived ? " · Archived" : "")),
    h("div", { class: "actions" },
      h("a", { class: "btn", href: `#/project/${p.id}/edit` }, "Edit"),
      h("button", { class: "btn", onclick: () => store.update("projects", p.id, { archived: !p.archived }) }, p.archived ? "Unarchive" : "Archive"),
      h("button", { class: "btn danger", onclick: async () => {
        if (await confirm(`Delete "${p.name}" and all its tasks and log entries? This can't be undone.`)) {
          store.remove("projects", p.id);
          navigate("#/projects");
        }
      } }, "Delete")));

  const tabBar = h("nav", { class: "tabs", "aria-label": "Project sections" },
    tabs.map(([k, label]) => h("a", { href: `#/project/${p.id}${k === "overview" ? "" : `/${k}`}`, class: tab === k ? "on" : "", "aria-current": tab === k ? "page" : undefined }, label)));

  let body;
  if (tab === "tasks") body = tasksPanel(store, p);
  else if (tab === "log") body = logPanel(store, p, openQuickLog);
  else body = overviewPanel(store, p, stages);

  return h("section", { class: "view" }, header, tabBar, body);
}

function overviewPanel(store, p, stages) {
  const pr = progress(store, p.id);
  const fields = PROJECT_TYPES[p.type].fields
    .filter((f) => p[f.key] !== null && p[f.key] !== "" && !(Array.isArray(p[f.key]) && !p[f.key].length))
    .map((f) => [f.label, Array.isArray(p[f.key]) ? p[f.key].join(", ") : f.date ? formatDate(p[f.key]) : String(p[f.key])]);
  const recent = store.list("log", (e) => e.projectId === p.id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 5);

  return h("div", { class: "grid2" },
    h("div", { class: "card" },
      p.description ? h("p", {}, p.description) : null,
      stages.length ? h("div", { class: "stage-box" },
        h("div", { class: "small muted" }, `Stage ${p.stage + 1} of ${stages.length}`),
        h("strong", {}, stages[p.stage]),
        stageTrack(p),
        h("div", { class: "actions" },
          h("button", { class: "btn", disabled: p.stage === 0 ? true : undefined, onclick: () => store.advanceStage(p.id, -1) }, "Back a stage"),
          h("button", { class: "btn primary", disabled: p.stage >= stages.length - 1 ? true : undefined, onclick: () => store.advanceStage(p.id, 1) },
            p.stage < stages.length - 1 ? `Move to ${stages[p.stage + 1]}` : "Final stage"))) : null,
      h("dl", { class: "facts" },
        ...[["Start", formatDate(p.startDate)], ["Due", formatDate(p.dueDate)], ["Tasks", pr.total ? `${pr.done} of ${pr.total} done` : "None"], ...fields]
          .filter(([, v]) => v).flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
      p.tags.length ? h("div", { class: "tags" }, p.tags.map((t) => h("span", { class: "chip" }, t))) : null),
    h("div", {},
      p.type === "ci" ? measurementsCard(store, p) : null,
      h("div", { class: "card" }, h("h2", {}, "Latest log"),
        recent.length ? h("ul", { class: "rows" }, recent.map((e) => h("li", {}, typeTag(e.type), " ", e.text, h("span", { class: "date" }, formatDate(e.date))))) : empty("No entries yet."))));
}

function measurementsCard(store, p) {
  const latest = store.latestMeasurement(p.id);
  const ms = store.list("measurements", (m) => m.projectId === p.id).sort((a, b) => b.date.localeCompare(a.date));
  const errors = errorBox();
  const form = h("form", { class: "inline-form" },
    h("input", { name: "value", type: "number", step: "any", placeholder: `New ${p.metric || "value"}${p.unit ? ` (${p.unit})` : ""}`, required: true, "aria-label": "Measurement" }),
    h("input", { name: "date", type: "date", value: todayISO(), "aria-label": "Date" }),
    h("button", { class: "btn", type: "submit" }, "Add"));
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    try { store.create("measurements", { ...formData(form), projectId: p.id }); } catch (err) { showErrors(errors, err); }
  });
  return h("div", { class: "card" }, h("h2", {}, "Before and after"),
    latest ? h("p", { class: "big" }, describeChange(p, latest.value)) : h("p", { class: "muted" }, p.baseline !== null ? `Baseline ${p.baseline}${p.unit ? ` ${p.unit}` : ""}. Add a measurement to see the change.` : "Set a baseline in Edit, then add measurements."),
    errors, form,
    ms.length ? h("ul", { class: "rows small" }, ms.map((m) => h("li", {}, `${m.value}${p.unit ? ` ${p.unit}` : ""}`,
      h("span", { class: "date" }, formatDate(m.date)),
      h("button", { class: "link", "aria-label": "Delete measurement", onclick: () => store.remove("measurements", m.id) }, "×")))) : null);
}

function tasksPanel(store, p) {
  const tasks = store.list("tasks", (t) => t.projectId === p.id).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  const errors = errorBox();
  const form = h("form", { class: "inline-form" },
    h("input", { name: "title", placeholder: "Add a task", required: true, maxlength: LIMITS.shortText, "aria-label": "Task title" }),
    h("input", { name: "dueDate", type: "date", "aria-label": "Due date" }),
    h("button", { class: "btn primary", type: "submit" }, "Add"));
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const max = Math.max(0, ...tasks.map((t) => t.sortOrder));
    try { store.create("tasks", { ...formData(form), projectId: p.id, sortOrder: max + 1 }); } catch (err) { showErrors(errors, err); }
  });
  const move = (i, dir) => {
    const a = tasks[i], b = tasks[i + dir];
    if (!b) return;
    store.update("tasks", a.id, { sortOrder: b.sortOrder });
    store.update("tasks", b.id, { sortOrder: a.sortOrder === b.sortOrder ? a.sortOrder + dir : a.sortOrder });
  };
  return h("div", { class: "card" }, errors, form,
    tasks.length ? h("ul", { class: "tasks" }, tasks.map((t, i) => {
      const box = h("input", { type: "checkbox", checked: t.done, "aria-label": `Done: ${t.title}` });
      box.addEventListener("change", () => store.setTaskDone(t.id, box.checked));
      return h("li", { class: t.done ? "done" : "" },
        box, h("span", { class: "grow" }, t.title),
        t.dueDate ? h("span", { class: `date${!t.done && t.dueDate < todayISO() ? " overdue" : ""}` }, formatDate(t.dueDate)) : null,
        h("button", { class: "link", "aria-label": "Move up", disabled: i === 0 ? true : undefined, onclick: () => move(i, -1) }, "↑"),
        h("button", { class: "link", "aria-label": "Move down", disabled: i === tasks.length - 1 ? true : undefined, onclick: () => move(i, 1) }, "↓"),
        h("button", { class: "link", "aria-label": `Delete ${t.title}`, onclick: () => store.remove("tasks", t.id) }, "×"));
    })) : empty("No tasks yet."));
}

function logPanel(store, p, openQuickLog) {
  const state = logPanel.state[p.id] ??= { type: "" };
  const entries = store.list("log", (e) => e.projectId === p.id && (!state.type || e.type === state.type))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const filter = select("type", [["", "All types"], ...LOG_TYPES.map((t) => [t, LOG_TYPE_LABELS[t]])], state.type);
  const wrap = h("div", { class: "card" });
  filter.addEventListener("change", () => { state.type = filter.value; wrap.replaceWith(logPanel(store, p, openQuickLog)); });

  fill(wrap,
    h("div", { class: "toolbar" }, filter, h("button", { class: "btn primary", onclick: () => openQuickLog(p.id) }, "Add entry")),
    entries.length ? h("ol", { class: "timeline" }, entries.map((e) => h("li", { class: `t-${e.type}` },
      h("div", { class: "t-head" }, typeTag(e.type),
        h("span", { class: "date" }, formatDate(e.date)),
        e.starred ? h("span", { class: "star", "aria-label": "Highlight" }, "★") : null,
        e.type === "blocker" && e.resolved ? h("span", { class: "chip" }, "Resolved") : null,
        h("span", { class: "grow" }),
        h("button", { class: "link", onclick: () => openQuickLog(p.id, e.id) }, "Edit")),
      h("p", {}, e.text),
      e.lesson ? h("p", { class: "small" }, h("strong", {}, "Lesson: "), e.lesson) : null,
      e.from ? h("p", { class: "small muted" }, `From ${e.from}`) : null,
      e.impact.length ? h("div", { class: "tags" }, e.impact.map((i) => h("span", { class: "chip" }, i)),
        e.impactValue !== null ? h("span", { class: "chip" }, `${e.impactValue} ${e.impactUnit}`.trim()) : null) : null))) : empty("No entries yet."));
  return wrap;
}
logPanel.state = {};

// ---- Quick log / entry editor (dialog) ------------------------------------

export function entryForm(store, { projectId, entryId, onDone, confirm }) {
  const existing = entryId ? store.get("log", entryId) : null;
  const e = existing ?? { type: "success", date: todayISO(), impact: [], projectId };
  const projects = store.list("projects", (p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name));
  const errors = errorBox();
  if (!projects.length) {
    return h("div", { class: "form" }, h("h2", {}, "Quick log"), empty("Create a project first.", h("a", { class: "btn primary", href: "#/new", onclick: () => onDone() }, "New project")));
  }

  const extras = h("div", {});
  const renderExtras = (type) => {
    fill(extras, 
      type === "success" ? h("fieldset", { class: "impact" }, h("legend", {}, "What did this improve?"),
        h("div", { class: "chips" }, IMPACTS.map((i) => h("label", { class: "chip-check" },
          h("input", { type: "checkbox", name: `impact-${i}`, value: i, dataset: { group: "impact" }, checked: e.impact?.includes(i) }), i))),
        h("div", { class: "row3" },
          field("Amount (optional)", h("input", { name: "impactValue", type: "number", step: "any", value: e.impactValue ?? "" })),
          field("Unit", h("input", { name: "impactUnit", placeholder: "h/week, $/yr…", value: e.impactUnit ?? "" })))) : null,
      type === "failure" ? field("Lesson learned (optional)", h("input", { name: "lesson", value: e.lesson ?? "" })) : null,
      type === "recognition" ? field("From", h("input", { name: "from", value: e.from ?? "", placeholder: "Who said it" })) : null,
      type === "blocker" ? h("label", { class: "check" }, h("input", { type: "checkbox", name: "resolved", checked: e.resolved }), " Resolved") : null,
    );
  };
  const typeSel = select("type", LOG_TYPES.map((t) => [t, LOG_TYPE_LABELS[t]]), e.type);
  typeSel.addEventListener("change", () => renderExtras(typeSel.value));
  renderExtras(e.type);

  const form = h("form", { class: "form", novalidate: true },
    h("h2", {}, existing ? "Edit entry" : "Quick log"),
    errors,
    h("div", { class: "row3" },
      field("Project", select("projectId", projects.map((p) => [p.id, p.name]), e.projectId ?? projects[0].id)),
      field("Type", typeSel)),
    field("What happened?", h("textarea", { name: "text", rows: 4, maxlength: LIMITS.logText, required: true, autofocus: true }, e.text ?? ""),
      "Voice input arrives in phase 4. Your phone keyboard's mic works now."),
    h("div", { class: "row3" },
      field("Date", h("input", { name: "date", type: "date", value: e.date })),
      h("label", { class: "check" }, h("input", { type: "checkbox", name: "starred", checked: e.starred }), " Highlight for reviews")),
    extras,
    h("div", { class: "actions" },
      existing ? h("button", { class: "btn danger", type: "button", onclick: async () => {
        if (await confirm("Delete this entry?")) { store.remove("log", existing.id); onDone(); }
      } }, "Delete") : null,
      h("span", { class: "grow" }),
      h("button", { class: "btn", type: "button", onclick: () => onDone() }, "Cancel"),
      h("button", { class: "btn primary", type: "submit" }, "Save")));

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const data = formData(form);
    data.impact ??= [];
    try {
      if (existing) store.update("log", existing.id, data);
      else store.create("log", data);
      onDone();
    } catch (err) { showErrors(errors, err); }
  });
  return form;
}

// ---- Settings -------------------------------------------------------------

export function settingsView(store, { version, native }) {
  const s = store.getSettings();
  const swatches = (pal, mode) => h("div", { class: "swatches", style: { background: pal[mode].bg } },
    ["surf", "acc", "ok", "fail", "block"].map((k) => h("i", { style: { background: pal[mode][k] } })));

  return h("section", { class: "view narrow" },
    h("div", { class: "card" }, h("h2", {}, "Theme"),
      h("div", { class: "palettes", role: "radiogroup", "aria-label": "Palette" },
        Object.entries(PALETTES).map(([id, pal]) => h("button", {
          class: `palette${s.palette === id ? " on" : ""}`, role: "radio", "aria-checked": s.palette === id ? "true" : "false",
          onclick: () => store.updateSettings({ palette: id }),
        }, swatches(pal, "L"), swatches(pal, "D"), h("span", {}, `${id}. ${pal.name}${id === "A" ? " (default)" : ""}`)))),
      h("div", { class: "segmented", role: "radiogroup", "aria-label": "Mode" },
        [["light", "Light"], ["dark", "Dark"], ["auto", "Follow device"]].map(([m, label]) => h("button", {
          class: s.mode === m ? "on" : "", role: "radio", "aria-checked": s.mode === m ? "true" : "false",
          onclick: () => store.updateSettings({ mode: m }),
        }, label)))),
    h("div", { class: "card" }, h("h2", {}, "Automatic log entries"),
      toggle(store, "autoLogStage", "Log a success when a project reaches its next stage"),
      toggle(store, "autoLogTasks", "Log a success when a task is completed")),
    h("div", { class: "card" }, h("h2", {}, "About"),
      h("p", {}, `Work Dashboard ${version}`),
      h("p", { class: "small muted" }, native ? "Data is stored only on this device." : "Development mode: running in a browser, data kept in this browser only."),
      h("p", { class: "small muted" }, "Sync, export, backup and voice arrive in later phases.")));
}

function toggle(store, key, label) {
  const box = h("input", { type: "checkbox", checked: store.getSettings()[key] });
  box.addEventListener("change", () => store.updateSettings({ [key]: box.checked }));
  return h("label", { class: "check" }, box, " ", label);
}
