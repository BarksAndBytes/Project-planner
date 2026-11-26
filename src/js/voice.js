// Voice input (spec 9). Android: the phone's speech recognizer (offline when
// the language pack is installed). Windows: Windows voice typing in the
// text box. Nothing is saved automatically; the text is always editable.

const tauri = () => globalThis.__TAURI__?.core;

// Spoken keyword at the start picks the entry type: "Win: ..." -> Success.
const KEYWORDS = [
  [/^(?:win|success|good news)\b[\s:,.\-]*/i, "success"],
  [/^(?:problem|failure|fail|issue)\b[\s:,.\-]*/i, "failure"],
  [/^(?:blocked|blocker)\b[\s:,.\-]*/i, "blocker"],
  [/^(?:decision)\b[\s:,.\-]*/i, "decision"],
  [/^(?:note)\b[\s:,.\-]*/i, "note"],
  [/^(?:recognition|kudos|praise)\b[\s:,.\-]*/i, "recognition"],
];

export function detectType(text) {
  const t = String(text ?? "").trim();
  for (const [re, type] of KEYWORDS) {
    if (re.test(t)) {
      const rest = t.replace(re, "");
      return { type, text: rest ? rest[0].toUpperCase() + rest.slice(1) : rest };
    }
  }
  return { type: null, text: t };
}

export function voiceAvailable() {
  return Boolean(tauri());
}

/**
 * Starts voice input for a textarea. Android resolves with the spoken
 * text; Windows opens voice typing and resolves with null (text arrives as
 * typing).
 */
export async function listen(textarea) {
  const t = tauri();
  textarea.focus();
  const res = await t.invoke("voice_listen");
  return res === "typing" ? null : res;
}

export const VOICE_HELP = {
  "no-recognizer": "This device has no speech recognizer. On Android, install or enable Google's speech services; your keyboard's mic also works.",
  cancelled: null,
};
