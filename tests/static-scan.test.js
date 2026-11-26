// Security checklist items 1 and 5, checked on every change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const jsDir = join(root, "src/js");
const files = readdirSync(jsDir).filter((f) => f.endsWith(".js")).map((f) => [f, readFileSync(join(jsDir, f), "utf8")]);

test("no HTML injection sinks or dynamic code in the screens", () => {
  const banned = [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function\s*\(/, /setAttribute\(\s*["']on/];
  for (const [name, src] of files) {
    for (const re of banned) assert.ok(!re.test(src), `${name} uses ${re}`);
  }
});

test("screens use fill() instead of raw replaceChildren/append (null would render as text)", () => {
  for (const [name, src] of files) {
    if (name === "dom.js") continue;
    assert.ok(!/\.replaceChildren\(/.test(src), `${name} uses replaceChildren; use fill() from dom.js`);
  }
});

test("the screens make no network requests", () => {
  // XML namespace identifiers in the Word writer look like URLs but are never fetched.
  const NAMESPACES = /https?:\/\/(schemas\.openxmlformats\.org|purl\.org|www\.w3\.org)\//g;
  const banned = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /navigator\.sendBeacon/, /https?:\/\//];
  for (const [name, src] of files) {
    const code = src.replace(NAMESPACES, "");
    for (const re of banned) assert.ok(!re.test(code), `${name} uses ${re}`);
  }
  const html = readFileSync(join(root, "src/index.html"), "utf8") + readFileSync(join(root, "src/styles.css"), "utf8");
  assert.ok(!/(src|href)=["']https?:/.test(html) && !/url\(\s*["']?https?:/.test(html), "external resource in HTML/CSS");
});

test("Tauri config keeps a strict CSP and no extra permissions", () => {
  const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const csp = conf.app.security.csp;
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.ok(!csp.includes("unsafe-inline") && !csp.includes("unsafe-eval"));
  const cap = JSON.parse(readFileSync(join(root, "src-tauri/capabilities/default.json"), "utf8"));
  assert.deepEqual(cap.permissions, ["core:default"]);
  const mobile = JSON.parse(readFileSync(join(root, "src-tauri/capabilities/mobile.json"), "utf8"));
  assert.deepEqual(mobile.platforms, ["android", "iOS"]);
  assert.deepEqual(mobile.permissions, ["barcode-scanner:default"]);
});
