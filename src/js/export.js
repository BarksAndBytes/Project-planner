// Export sheet (spec 4, 8): choose the period and projects, preview the
// summary, undo any wording change, then export as Word, text, CSV or print.

import { h, fill, field, select } from "./dom.js";
import { PROJECT_TYPES } from "./model.js";
import { buildSummary, periodRange, summaryToText, entriesToCsv, fmtDate } from "./summary.js";
import { summaryToDocx } from "./docx.js";

const tauri = () => globalThis.__TAURI__?.core;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Remembered while the app is open.
const state = { period: null, from: "", to: "", scope: "all", keep: new Set() };

function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function saveFile(name, bytes, mime, status, isAndroid) {
  const t = tauri();
  if (!t) {
    // Development in a browser: a normal download.
    const a = h("a", { download: name });
    a.href = URL.createObjectURL(new Blob([bytes], { type: mime }));
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return;
  }
  try {
    const where = await t.invoke("save_export", { name, data: b64(bytes), mime });
    if (isAndroid) {
      fill(status, h("p", { class: "small muted" }, "Choose where to send it in the share menu."));
    } else {
      fill(status,
        h("p", { class: "ok" }, `Saved to ${where}`),
        h("button", { class: "btn", onclick: () => t.invoke("reveal_export", { path: where }) }, "Show in folder"));
    }
  } catch (err) {
    fill(status, h("p", { class: "errors" }, `Couldn't save: ${err}`));
  }
}

function previewDoc(s, onUndo) {
  const item = (x) => h("li", {}, x.text,
    x.project && !s.single ? h("span", { class: "muted" }, ` (${x.project})`) : null,
    x.reworded ? h("button", { class: "link small", title: "Use my original words", onclick: () => onUndo(x.id) }, "undo wording") : null);
  const list = (items) => h("ul", {}, items.map(item));
  const section = (title, ...content) => h("section", {}, h("h3", {}, title), ...content);
  return h("article", { class: "doc-preview", "aria-label": "Summary preview" },
    h("h2", {}, s.title),
    h("p", { class: "muted small" }, `Prepared ${fmtDate(s.prepared)}${s.single ? ` · ${s.single.type}: ${s.single.name}` : ""}`),
    s.empty ? h("p", {}, "Nothing logged in this period yet. Try a longer period, or log some wins first.") : null,
    s.highlights.length ? section("Highlights", list(s.highlights)) : null,
    s.totals.length ? section("By the numbers", h("p", { class: "totals" }, s.totals.join("  ·  "))) : null,
    s.results.length || s.otherResults.length ? section("Results by impact",
      ...s.results.flatMap((g) => [h("h4", {}, g.impact), list(g.items)]),
      s.otherResults.length ? [h("h4", {}, "Other results"), list(s.otherResults)] : null) : null,
    s.delivered.length ? section(s.projectsHeading, h("table", {},
      h("thead", {}, h("tr", {}, ["Type", "Project", "Stage reached", "Before → after"].map((c) => h("th", {}, c)))),
      h("tbody", {}, s.delivered.map((p) => h("tr", {}, [p.type, p.name, p.stage, p.metric].map((c) => h("td", {}, c)))))) ) : null,
    s.capability.length ? section("Capability built", list(s.capability)) : null,
    s.recognition.length ? section("Recognition", h("ul", {}, s.recognition.map((r) => h("li", {}, h("em", {}, `“${r.quote}”`), h("span", { class: "muted" }, ` (${[r.from, fmtDate(r.date)].filter(Boolean).join(", ")})`))))) : null,
    s.tasks.length ? section("Tasks completed", list(s.tasks)) : null,
    s.challenges.length ? section("Challenges handled", h("ul", {}, s.challenges.map((c) => h("li", {}, h("strong", {}, "Challenge: "), c.challenge, c.lesson ? [h("strong", {}, "  Lesson: "), c.lesson] : null)))) : null,
    s.nextPriorities.length ? section("Next priorities", h("ul", {}, s.nextPriorities.map((n) => h("li", {}, n.text,
      !s.single ? h("span", { class: "muted" }, ` (${n.project})`) : null, n.due ? h("span", { class: "muted" }, `, due ${fmtDate(n.due)}`) : null)))) : null);
}

export function exportView(store, { projectId = null, isAndroid }) {
  const settings = store.getSettings();
  state.period ??= settings.exportDefaultRange;
  if (projectId && state.scope !== `project:${projectId}`) { state.scope = `project:${projectId}`; state.keep = new Set(); }
  const projects = store.list("projects").sort((a, b) => a.name.localeCompare(b.name));
  const root = h("section", { class: "view export-view" });
  const preview = h("div", {});
  const status = h("div", { role: "status" });

  const opts = () => {
    const period = periodRange(state.period, { lastReviewDate: settings.lastReviewDate, from: state.from || undefined, to: state.to || undefined });
    const [kind, id] = state.scope.split(":");
    return {
      period,
      projectIds: kind === "project" ? [id] : null,
      type: kind === "type" ? id : null,
      includeChallenges: store.getSettings().exportIncludeFailures,
      includeTasks: store.getSettings().exportIncludeTasks,
      includeRecognition: store.getSettings().exportIncludeRecognition,
      keepOriginal: state.keep,
      ownerName: store.getSettings().ownerName,
    };
  };
  let current = null;
  const refresh = () => {
    current = buildSummary(store, opts());
    fill(preview,
      current.changes.length ? h("p", { class: "small muted" }, `${current.changes.length} entr${current.changes.length === 1 ? "y was" : "ies were"} reworded (filler removed, numbers added). Tap "undo wording" to keep your original words.`) : null,
      previewDoc(current, (id) => { state.keep.add(id); refresh(); }));
  };

  const periodSel = select("period", [["month", "This month"], ["quarter", "This quarter"], ["year", "This year"], ["review", "Since my last review"], ["custom", "Custom dates"]], state.period);
  const from = h("input", { type: "date", value: state.from, "aria-label": "From" });
  const to = h("input", { type: "date", value: state.to, "aria-label": "To" });
  const custom = h("div", { class: "row3", hidden: state.period !== "custom" ? true : undefined }, field("From", from), field("To", to));
  periodSel.addEventListener("change", () => { state.period = periodSel.value; custom.hidden = state.period !== "custom"; refresh(); });
  from.addEventListener("change", () => { state.from = from.value; refresh(); });
  to.addEventListener("change", () => { state.to = to.value; refresh(); });

  const scopeSel = select("scope", [["all", "All projects"],
    ...Object.entries(PROJECT_TYPES).map(([k, t]) => [`type:${k}`, `All ${t.label.toLowerCase()} projects`]),
    ...projects.map((p) => [`project:${p.id}`, p.name])], state.scope);
  scopeSel.addEventListener("change", () => { state.scope = scopeSel.value; state.keep = new Set(); refresh(); });

  const toggle = (key, label) => {
    const box = h("input", { type: "checkbox", checked: store.getSettings()[key] });
    box.addEventListener("change", () => { try { store.updateSettings({ [key]: box.checked }); } catch { /* view-only */ } refresh(); });
    return h("label", { class: "check" }, box, " ", label);
  };
  const owner = h("input", { value: settings.ownerName, maxlength: 60, placeholder: "Your name", "aria-label": "Your name" });
  owner.addEventListener("change", () => { try { store.updateSettings({ ownerName: owner.value }); } catch { /* view-only */ } refresh(); });

  const fileBase = () => current.title.replace(/^Work Summary:?\s*/, "Work Summary ").replace(/,/g, "");
  const actions = h("div", { class: "actions export-actions" },
    h("button", { class: "btn primary", onclick: () => saveFile(`${fileBase()}.docx`, summaryToDocx(current), DOCX_MIME, status, isAndroid) }, "Word (.docx)"),
    h("button", { class: "btn", onclick: async () => {
      try { await navigator.clipboard.writeText(summaryToText(current)); fill(status, h("p", { class: "ok" }, "Copied. Paste it into an email, Teams or a review form.")); }
      catch { fill(status, h("p", { class: "errors" }, "Couldn't copy on this device.")); }
    } }, "Copy as text"),
    h("button", { class: "btn", onclick: () => saveFile(`${fileBase()} - log entries.csv`, new TextEncoder().encode(entriesToCsv(store, opts())), "text/csv", status, isAndroid) }, "CSV"),
    !isAndroid ? h("button", { class: "btn", onclick: () => window.print() }, "Print / PDF") : null);

  fill(root,
    h("div", { class: "card no-print" },
      h("h2", {}, "Work summary"),
      h("div", { class: "row3" }, field("Period", periodSel), field("Projects", scopeSel)),
      custom,
      field("Name on the summary", owner),
      h("div", { class: "chips-row" },
        toggle("exportIncludeFailures", "Include challenges handled"),
        toggle("exportIncludeTasks", "Include completed tasks"),
        toggle("exportIncludeRecognition", "Include recognition")),
      actions, status),
    preview);
  refresh();
  return root;
}
