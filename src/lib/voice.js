/* ============================================================
   Dialect & Voice module.
   Two tiers: an AI-cast voice per character (Gemini TTS, via the
   backend -- see speakAsCharacterOrFallback() below) when one has
   been cast, and the browser's built-in Web Speech API otherwise
   or if the AI voice is unavailable for any reason (no cast yet,
   Gemini quota exhausted, network error). Web Speech needs no
   external key, so it's always the safety net -- speak()/
   speakAsCharacterOrFallback() never just go silent.
   Each faction also gets a deterministic pitch/rate "accent"
   derived from its dialect profile, and a consistently-assigned
   system voice, so the same faction always sounds the same across
   the session on the Web Speech path.
   ============================================================ */

import { speakAsCharacter } from "./api";

let cachedVoices = [];
// The currently-playing AI-voice <audio> element, if any -- tracked so
// stopSpeaking() can stop it the same way it cancels Web Speech.
let currentAudio = null;
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
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (voiceSupported()) window.speechSynthesis.cancel();
}

/** Speak `text` as `asset` (a character): if asset.voiceId is set (a voice
 *  has been cast for them), plays it back via the backend's Gemini TTS
 *  synthesis; on any failure there -- or if no voice has been cast yet --
 *  falls straight back to speak() (Web Speech), so a reply is never just
 *  silent. handlers: same {onStart, onEnd} shape as speak(). */
export async function speakAsCharacterOrFallback(worldId, asset, text, dialectProfiles, handlers = {}) {
  stopSpeaking();
  if (asset?.voiceId) {
    try {
      const url = await speakAsCharacter(worldId, asset.id, text);
      const audio = new Audio(url);
      currentAudio = audio;
      const cleanup = () => {
        if (currentAudio === audio) currentAudio = null;
        URL.revokeObjectURL(url);
        handlers.onEnd?.();
      };
      audio.onplay = () => handlers.onStart?.();
      audio.onended = cleanup;
      audio.onerror = cleanup;
      await audio.play();
      return;
    } catch (_e) {
      // AI voice unavailable right now (no cast yet, quota exhausted,
      // network error) -- fall through to the Web Speech path below.
    }
  }
  speak(text, asset?.faction, dialectProfiles, handlers);
}
