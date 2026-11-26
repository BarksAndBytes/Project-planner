// Search across projects, tasks and log entries (phase 5).

import { h, fill, formatDate } from "./dom.js";
import { LOG_TYPE_LABELS, PROJECT_TYPES } from "./model.js";

let lastQuery = "";

export function searchItems(store, query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return { projects: [], tasks: [], log: [] };
  const has = (...vals) => vals.some((v) => (Array.isArray(v) ? v.join(" ") : String(v ?? "")).toLowerCase().includes(q));
  const projects = store.list("projects");
  const name = new Map(projects.map((p) => [p.id, p.name]));
  return {
    projects: projects.filter((p) => has(p.name, p.description, p.tags, p.customer, p.partNumbers, p.orderNo, p.partOrFamily, p.metric, p.system, p.vendor, p.location, p.expectedBenefit, PROJECT_TYPES[p.type].label)),
    tasks: store.list("tasks", (t) => has(t.title)).map((t) => ({ ...t, project: name.get(t.projectId) })),
    log: store.list("log", (e) => has(e.text, e.lesson, e.from)).sort((a, b) => b.date.localeCompare(a.date)).map((e) => ({ ...e, project: name.get(e.projectId) })),
  };
}

export function searchView(store) {
  const input = h("input", { type: "search", value: lastQuery, placeholder: "Search projects, tasks and log entries", "aria-label": "Search", autofocus: true });
  const results = h("div", {});
  const run = () => {
    lastQuery = input.value;
    const r = searchItems(store, input.value);
    const total = r.projects.length + r.tasks.length + r.log.length;
    fill(results,
      input.value.trim().length < 2 ? h("p", { class: "muted" }, "Type at least 2 letters.") : !total ? h("p", { class: "muted" }, "Nothing found.") : null,
      r.projects.length ? h("div", { class: "card" }, h("h2", {}, `Projects (${r.projects.length})`),
        h("ul", { class: "rows" }, r.projects.map((p) => h("li", {}, h("a", { href: `#/project/${p.id}` }, p.name), h("small", { class: "muted" }, ` · ${PROJECT_TYPES[p.type].label}`))))) : null,
      r.tasks.length ? h("div", { class: "card" }, h("h2", {}, `Tasks (${r.tasks.length})`),
        h("ul", { class: "rows" }, r.tasks.map((t) => h("li", {}, h("a", { href: `#/project/${t.projectId}/tasks` }, t.title), h("small", { class: "muted" }, ` · ${t.project ?? ""}${t.done ? " · done" : ""}`))))) : null,
      r.log.length ? h("div", { class: "card" }, h("h2", {}, `Log entries (${r.log.length})`),
        h("ul", { class: "rows" }, r.log.slice(0, 100).map((e) => h("li", {}, h("a", { href: `#/project/${e.projectId}/log` }, e.text), h("small", { class: "muted" }, ` · ${LOG_TYPE_LABELS[e.type]} · ${e.project ?? ""} · ${formatDate(e.date)}`))))) : null);
  };
  input.addEventListener("input", run);
  run();
  return h("section", { class: "view narrow" }, h("div", { class: "toolbar" }, input), results);
}
