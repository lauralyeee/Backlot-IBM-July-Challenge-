/* ============================================================
   Dialect & Voice module (stretch goal, section 9.7).
   Uses the browser's built-in Web Speech API (no external TTS
   key needed for a POC). Each faction gets a deterministic
   pitch/rate "accent" derived from its dialect profile, and a
   consistently-assigned system voice, so the same faction always
   sounds the same across the session.
   ============================================================ */

let cachedVoices = [];
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  const load = () => { cachedVoices = window.speechSynthesis.getVoices(); };
  load();
  window.speechSynthesis.onvoiceschanged = load;
}

export function voiceSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function voiceForFaction(faction) {
  const voices = cachedVoices.filter((v) => v.lang?.startsWith("en"));
  const pool = voices.length ? voices : cachedVoices;
  if (!pool.length) return null;
  return pool[hashString(faction || "narrator") % pool.length];
}

/** dialectProfiles: map of faction name -> { style, rate, pitch } from worldData personas.
 *  handlers: optional { onStart, onEnd } lifecycle callbacks — used by the
 *  Characters screen to drive the portrait's "talking" animation while the
 *  line is actually being spoken. onEnd also fires on error/cancel so the
 *  animation can never get stuck on. */
export function speak(text, faction, dialectProfiles, handlers = {}) {
  if (!voiceSupported() || !text) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const profile = dialectProfiles?.[faction];
  utter.rate = profile?.rate ?? 1.0;
  utter.pitch = profile?.pitch ?? 1.0;
  const v = voiceForFaction(faction);
  if (v) utter.voice = v;
  utter.onstart = () => handlers.onStart?.();
  utter.onend = () => handlers.onEnd?.();
  utter.onerror = () => handlers.onEnd?.();
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking() {
  if (voiceSupported()) window.speechSynthesis.cancel();
}

/* ── Voice input (speech-to-text) ─────────────────────────────────────
   Same Web Speech API family as speech synthesis above, so still no
   external service or key. Supported in Chrome/Edge/Safari; NOT in
   Firefox — callers must gate the UI on recognitionSupported(). */

export function recognitionSupported() {
  return (
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  );
}

/** Start one-shot speech recognition. Returns the recognition instance so
 *  the caller can .stop() it early, or null if unsupported.
 *  handlers: { onResult(transcript), onError(err), onEnd() } — onEnd fires
 *  after both success and error, so UI "listening" state resets reliably. */
export function startListening({ onResult, onError, onEnd } = {}) {
  const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SR) {
    onError?.(new Error("Speech recognition is not supported in this browser"));
    onEnd?.();
    return null;
  }
  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (ev) => {
    const transcript = ev.results?.[0]?.[0]?.transcript;
    if (transcript) onResult?.(transcript);
  };
  rec.onerror = (ev) => onError?.(new Error(ev.error || "speech recognition error"));
  rec.onend = () => onEnd?.();
  rec.start();
  return rec;
}
