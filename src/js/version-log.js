// Version and security log shown in Settings → About (checklist item 12).
// Keep in step with docs/VERSION_LOG.md.
export const VERSION_LOG = [
  {
    version: "0.2.0 (test builds, not released)",
    date: "2026-11-26",
    changes: "Device sync by QR (encrypted, Noise XX), network check, work summary export (Word, text, CSV, print), voice input, encrypted backup, app lock, kiosk mode, search, Copy for Claude.",
    checks: "1, 3, 5, 6 (protocol tests), 7, 8, 9, 10, 11 (contrast) automated; device smoke test pending.",
  },
  {
    version: "0.1.0 (test builds, not released)",
    date: "2026-11-25",
    changes: "Projects, tasks, work log, dashboard, three palettes, encrypted local storage.",
    checks: "1, 5, 7, 9, 10, 11 (contrast) automated.",
  },
];
