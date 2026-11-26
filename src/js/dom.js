// Tiny DOM builder. Text always goes in as text nodes, never as HTML
// (security checklist item 1). There is no innerHTML anywhere in the app;
// tests/static-scan.test.js enforces that.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = Boolean(v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "href") el.setAttribute("href", safeHref(v));
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// In-app links are hash routes only.
function safeHref(v) {
  const s = String(v);
  return s.startsWith("#") ? s : "#";
}

// Replaces an element's children, skipping null/false entries. (The DOM's
// own replaceChildren() would show them as the text "null".)
export function fill(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
}

export function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), input, hint ? h("small", { class: "hint" }, hint) : null);
}

export function select(name, options, current) {
  return h("select", { name }, options.map((o) => {
    const [value, text] = Array.isArray(o) ? o : [o, o];
    return h("option", { value, selected: value === current ? true : undefined }, text);
  }));
}

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") {
      if (el.dataset.group) {
        out[el.dataset.group] ??= [];
        if (el.checked) out[el.dataset.group].push(el.value);
      } else {
        out[el.name] = el.checked;
      }
    } else out[el.name] = el.value;
  }
  return out;
}

export function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
