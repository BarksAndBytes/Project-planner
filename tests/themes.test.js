import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTES, TEXT_PAIRS, contrastRatio, resolveMode, themeVars } from "../src/js/themes.js";

// Security and quality checklist item 11: every palette and mode keeps text
// at 4.5:1 contrast or better.
for (const [id, palette] of Object.entries(PALETTES)) {
  for (const mode of ["L", "D"]) {
    test(`palette ${id} (${palette.name}) ${mode === "L" ? "light" : "dark"} meets 4.5:1`, () => {
      for (const [fg, bg] of TEXT_PAIRS) {
        const r = contrastRatio(palette[mode][fg], palette[mode][bg]);
        assert.ok(r >= 4.5, `${fg} on ${bg} is ${r.toFixed(2)}:1`);
      }
    });
  }
}

test("all palettes define the same tokens", () => {
  const keys = Object.keys(PALETTES.A.L).sort().join();
  for (const p of Object.values(PALETTES)) {
    assert.equal(Object.keys(p.L).sort().join(), keys);
    assert.equal(Object.keys(p.D).sort().join(), keys);
  }
});

test("mode resolution", () => {
  assert.equal(resolveMode("auto", true), "D");
  assert.equal(resolveMode("auto", false), "L");
  assert.equal(resolveMode("light", true), "L");
  assert.equal(themeVars("B", "D")["--acc"], "#7D9BFF");
  assert.equal(themeVars("nope", "L")["--acc"], PALETTES.A.L.acc);
});
