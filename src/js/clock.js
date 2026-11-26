// Hybrid logical clock (HLC) stamps for ordering edits across devices.
//
// A stamp is "TTTTTTTTTTTTT-CCCCC-<deviceId>": wall-clock milliseconds, a
// counter for edits within the same millisecond, and the device that made
// the edit. Stamps compare correctly as plain strings, the device id breaks
// exact ties, and a device's own stamps always increase, even if its
// wall clock goes backwards.

const STAMP_RE = /^(\d{13})-(\d{5})-([0-9a-f-]{36})$/i;
export const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

export function parseStamp(s) {
  const m = typeof s === "string" ? STAMP_RE.exec(s) : null;
  return m ? { t: Number(m[1]), c: Number(m[2]), device: m[3].toLowerCase() } : null;
}

export function formatStamp(t, c, device) {
  return `${String(t).padStart(13, "0")}-${String(c).padStart(5, "0")}-${device}`;
}

export function createClock(deviceId, nowMs = () => Date.now()) {
  let lastT = 0;
  let lastC = 0;
  return {
    /** A new stamp, later than every stamp this device has made or seen. */
    tick() {
      const wall = nowMs();
      if (wall > lastT) { lastT = wall; lastC = 0; } else { lastC += 1; }
      if (lastC > 99999) { lastT += 1; lastC = 0; }
      return formatStamp(lastT, lastC, deviceId);
    },
    /** Moves this clock past a stamp received from another device. */
    observe(stamp) {
      const p = parseStamp(stamp);
      if (!p) return;
      if (p.t > lastT || (p.t === lastT && p.c > lastC)) { lastT = p.t; lastC = p.c; }
    },
    /** True if a received stamp is valid and not implausibly far in the future. */
    acceptable(stamp) {
      const p = parseStamp(stamp);
      return Boolean(p) && p.t <= nowMs() + MAX_FUTURE_MS;
    },
  };
}

/** Stamp for data saved before stamps existed: derived from updatedAt. */
export function legacyStamp(isoDate, deviceId) {
  const t = Date.parse(isoDate);
  return formatStamp(Number.isFinite(t) && t > 0 ? t : 1, 0, deviceId);
}
