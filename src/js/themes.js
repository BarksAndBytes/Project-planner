// Palettes and theme switching (spec 4.1). Values come from the approved
// "Dashboard Palette Options" preview. Every color is a named token, so a
// fourth palette is one more entry here.

export const PALETTES = {
  A: {
    name: "Shop Steel",
    L: { bg: "#EEF1F4", surf: "#FFFFFF", sunk: "#E3E8ED", line: "#CBD3DB", ink: "#16202A", muted: "#5B6875", acc: "#0E5E7E", accink: "#FFFFFF", ok: "#1E7A46", fail: "#B3261E", block: "#9A5B00", note: "#55636F", dec: "#5B4BB7", tagink: "#FFFFFF" },
    D: { bg: "#0F161D", surf: "#18222C", sunk: "#0B1117", line: "#2C3A47", ink: "#E6ECF1", muted: "#93A2B0", acc: "#5FB3D3", accink: "#0B1117", ok: "#6FCF97", fail: "#F2867E", block: "#F0B35A", note: "#A9B6C2", dec: "#B3A7F5", tagink: "#0B1117" },
  },
  B: {
    name: "Datasheet Cobalt",
    L: { bg: "#F4F6FC", surf: "#FFFFFF", sunk: "#E6EBFA", line: "#D3D9EA", ink: "#0B0F1A", muted: "#535B70", acc: "#1240E0", accink: "#FFFFFF", ok: "#18794E", fail: "#C4321C", block: "#9C5A00", note: "#566074", dec: "#7A3DB8", tagink: "#FFFFFF" },
    D: { bg: "#0A0D18", surf: "#141A2C", sunk: "#070A12", line: "#26304A", ink: "#E8ECF8", muted: "#97A0B8", acc: "#7D9BFF", accink: "#0A0D18", ok: "#5FD39A", fail: "#FF8A75", block: "#F2B861", note: "#A8B1C6", dec: "#C9A2F5", tagink: "#0A0D18" },
  },
  C: {
    name: "Survey Magenta",
    L: { bg: "#F6F5EE", surf: "#FFFFFF", sunk: "#ECEADF", line: "#DAD7C8", ink: "#13242E", muted: "#5A6870", acc: "#B8105F", accink: "#FFFFFF", ok: "#21764A", fail: "#B83A12", block: "#8C6400", note: "#566670", dec: "#2D5FA8", tagink: "#FFFFFF" },
    D: { bg: "#0D1C24", surf: "#152A35", sunk: "#091319", line: "#28414E", ink: "#E9EFEF", muted: "#97A9B1", acc: "#FF5CA8", accink: "#0D1C24", ok: "#6FD39C", fail: "#FF9466", block: "#EBC15C", note: "#A8BAC1", dec: "#8DB6F5", tagink: "#0D1C24" },
  },
};

// Log type -> token, so status colors keep their meaning in every palette.
export const TYPE_TOKEN = {
  success: "ok", failure: "fail", blocker: "block", note: "note", decision: "dec", recognition: "acc",
};

export function resolveMode(mode, systemPrefersDark) {
  if (mode === "light") return "L";
  if (mode === "dark") return "D";
  return systemPrefersDark ? "D" : "L";
}

export function themeVars(paletteId, modeKey) {
  const p = PALETTES[paletteId] ?? PALETTES.A;
  const colors = p[modeKey] ?? p.L;
  return Object.fromEntries(Object.entries(colors).map(([k, v]) => [`--${k}`, v]));
}

export function applyTheme(root, settings, systemPrefersDark) {
  const modeKey = resolveMode(settings.mode, systemPrefersDark);
  for (const [k, v] of Object.entries(themeVars(settings.palette, modeKey))) root.style.setProperty(k, v);
  root.style.colorScheme = modeKey === "D" ? "dark" : "light";
  root.dataset.palette = settings.palette;
}

// WCAG 2.x contrast ratio between two hex colors.
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function luminance(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The text/background pairs the app actually draws (checklist item 11).
export const TEXT_PAIRS = [
  ["ink", "bg"], ["ink", "surf"], ["ink", "sunk"],
  ["muted", "surf"], ["muted", "bg"],
  ["accink", "acc"], ["acc", "surf"],
  ["tagink", "ok"], ["tagink", "fail"], ["tagink", "block"], ["tagink", "note"], ["tagink", "dec"],
];
