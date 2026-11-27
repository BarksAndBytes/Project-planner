// Renders the app icon (design E, "Clipboard check") to desktop and Android sizes.
// Usage: node scripts/render-icons.mjs src-tauri   (needs the sharp package)
import { createRequire } from "node:module";
const sharp = createRequire(import.meta.url)("sharp");
import { mkdirSync, writeFileSync } from "node:fs";
const A = "#0E5E7E", G = "#6FCF97", W = "#FFFFFF";
const glyph = `<rect x="29" y="25" width="42" height="54" rx="7" fill="none" stroke="${W}" stroke-width="6"/><rect x="40" y="18" width="20" height="13" rx="4" fill="${W}"/><path d="M38 54 L47 63 L63 44" fill="none" stroke="${G}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
const tile = (s) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100"><rect x="4" y="4" width="92" height="92" rx="22" fill="${A}"/>${glyph}</svg>`);
const round = (s) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="${A}"/>${glyph}</svg>`);
// Adaptive foreground: 108dp canvas, glyph inside the central 66dp safe zone (scale 0.66, centred).
const fg = (s) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100"><g transform="translate(50 50) scale(0.88) translate(-50 -48.5)">${glyph}</g></svg>`);
const out = process.argv[2];
const png = (svg, file) => sharp(svg).png().toFile(file);
mkdirSync(`${out}/icons`, { recursive: true });
await png(tile(32), `${out}/icons/32x32.png`);
await png(tile(128), `${out}/icons/128x128.png`);
await png(tile(256), `${out}/icons/128x128@2x.png`);
await png(tile(512), `${out}/icons/icon.png`);
await png(tile(1024), `${out}/app-icon.png`);
// ICO with 16, 32, 48, 256 PNG entries
const sizes = [16, 32, 48, 256];
const pngs = await Promise.all(sizes.map((s) => sharp(tile(s)).png().toBuffer()));
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length; const dirs = [];
sizes.forEach((s, i) => { const d = Buffer.alloc(16); d.writeUInt8(s % 256, 0); d.writeUInt8(s % 256, 1); d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6); d.writeUInt32LE(pngs[i].length, 8); d.writeUInt32LE(offset, 12); offset += pngs[i].length; dirs.push(d); });
writeFileSync(`${out}/icons/icon.ico`, Buffer.concat([header, ...dirs, ...pngs]));
// Android launcher resources
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  const dir = `${out}/android/res/mipmap-${d}`; mkdirSync(dir, { recursive: true });
  await png(tile(48 * k), `${dir}/ic_launcher.png`);
  await png(round(48 * k), `${dir}/ic_launcher_round.png`);
  await png(fg(108 * k), `${dir}/ic_launcher_foreground.png`);
}
mkdirSync(`${out}/android/res/mipmap-anydpi-v26`, { recursive: true });
const adaptive = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n`;
writeFileSync(`${out}/android/res/mipmap-anydpi-v26/ic_launcher.xml`, adaptive);
writeFileSync(`${out}/android/res/mipmap-anydpi-v26/ic_launcher_round.xml`, adaptive);
mkdirSync(`${out}/android/res/values`, { recursive: true });
writeFileSync(`${out}/android/res/values/ic_launcher_background.xml`, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${A}</color>\n</resources>\n`);
console.log("done");
