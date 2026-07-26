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

/** dialectProfiles: map of faction name -> { style, rate, pitch } from worldData personas */
export function speak(text, faction, dialectProfiles) {
  if (!voiceSupported() || !text) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const profile = dialectProfiles?.[faction];
  utter.rate = profile?.rate ?? 1.0;
  utter.pitch = profile?.pitch ?? 1.0;
  const v = voiceForFaction(faction);
  if (v) utter.voice = v;
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking() {
  if (voiceSupported()) window.speechSynthesis.cancel();
}
