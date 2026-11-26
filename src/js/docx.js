// Word (.docx) export of a work summary (spec 8). Built in the app, offline,
// with no outside library: a .docx is a ZIP of a few XML files. Always a
// plain black-on-white layout, whatever theme is chosen (spec 4.1).

import { zip } from "./zip.js";
import { fmtDate } from "./summary.js";

const esc = (s) => String(s ?? "")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const run = (text, { bold = false, italic = false, color = null } = {}) =>
  `<w:r>${bold || italic || color ? `<w:rPr>${bold ? "<w:b/>" : ""}${italic ? "<w:i/>" : ""}${color ? `<w:color w:val="${color}"/>` : ""}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const para = (runs, style = null) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${runs}</w:p>`;
const heading = (text) => para(run(text), "Heading1");
const bullet = (runs) => para(runs, "ListBullet");
const muted = (text) => run(text, { color: "555555" });

function table(header, rows) {
  const cell = (content, bold) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${run(content, { bold })}</w:p></w:tc>`;
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>`
    + `<w:tr>${header.map((h) => cell(h, true)).join("")}</w:tr>`
    + rows.map((r) => `<w:tr>${r.map((c) => cell(c, false)).join("")}</w:tr>`).join("")
    + "</w:tbl>";
}

export function summaryToDocxXml(s) {
  const body = [];
  const proj = (x) => (x.project && !s.single ? muted(` (${x.project})`) : "");
  body.push(para(run(s.title), "Title"));
  body.push(para(muted(`Prepared ${fmtDate(s.prepared)}${s.single ? ` · ${s.single.type}: ${s.single.name}` : ""}`)));
  if (s.highlights.length) {
    body.push(heading("Highlights"));
    for (const x of s.highlights) body.push(bullet(run(x.text) + proj(x)));
  }
  if (s.totals.length) {
    body.push(heading("By the numbers"));
    body.push(para(run(s.totals.join("  ·  "), { bold: true })));
  }
  if (s.results.length || s.otherResults.length) {
    body.push(heading("Results by impact"));
    for (const g of s.results) {
      body.push(para(run(g.impact, { bold: true })));
      for (const x of g.items) body.push(bullet(run(x.text) + proj(x)));
    }
    if (s.otherResults.length) {
      body.push(para(run("Other results", { bold: true })));
      for (const x of s.otherResults) body.push(bullet(run(x.text) + proj(x)));
    }
  }
  if (s.delivered.length) {
    body.push(heading(s.projectsHeading));
    body.push(table(["Type", "Project", "Stage reached", "Before → after"], s.delivered.map((p) => [p.type, p.name, p.stage, p.metric || ""])));
  }
  if (s.capability.length) {
    body.push(heading("Capability built"));
    for (const x of s.capability) body.push(bullet(run(x.text) + proj(x)));
  }
  if (s.recognition.length) {
    body.push(heading("Recognition"));
    for (const r of s.recognition) body.push(bullet(run(`“${r.quote}”`, { italic: true }) + muted(` (${[r.from, fmtDate(r.date)].filter(Boolean).join(", ")})`)));
  }
  if (s.tasks.length) {
    body.push(heading("Tasks completed"));
    for (const t of s.tasks) body.push(bullet(run(t.text) + proj(t)));
  }
  if (s.challenges.length) {
    body.push(heading("Challenges handled"));
    for (const c of s.challenges) body.push(bullet(run("Challenge: ", { bold: true }) + run(c.challenge) + (c.lesson ? run("  Lesson: ", { bold: true }) + run(c.lesson) : "") + proj(c)));
  }
  if (s.nextPriorities.length) {
    body.push(heading("Next priorities"));
    for (const n of s.nextPriorities) body.push(bullet(run(n.text) + proj(n) + (n.due ? muted(`, due ${fmtDate(n.due)}`) : "")));
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="000000"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
  + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
  + `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>`
  + `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="999999"/></w:pBdr></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>`
  + `<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="40"/></w:pPr></w:style>`
  + `</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

function coreProps(title, now) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>Work Dashboard</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`;
}

export function summaryToDocx(summary, now = new Date()) {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return zip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: ROOT_RELS },
    { name: "docProps/core.xml", data: coreProps(summary.title, iso) },
    { name: "word/_rels/document.xml.rels", data: DOC_RELS },
    { name: "word/document.xml", data: summaryToDocxXml(summary) },
    { name: "word/styles.xml", data: STYLES },
    { name: "word/numbering.xml", data: NUMBERING },
  ], now);
}
