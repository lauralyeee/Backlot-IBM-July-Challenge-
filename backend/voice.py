"""
Gemini TTS voice module -- server-side.

MIGRATED 2026-07-28 from ElevenLabs (see this file's git history / the
project's "Project State" doc for the full ElevenLabs story: a bespoke
Voice Design flow that turned out to need a paid plan via API, then a
"match against the account's existing voice library" pivot that worked
but hit a second, harder wall -- ElevenLabs' library/community voices are
blanket-restricted from the free-tier API regardless of how they're
selected, confirmed via their own docs after a live 402. Rather than pay
for ElevenLabs Starter, Laura chose to switch providers entirely.

Architecturally this is a different shape, not just a different vendor,
and that difference matters for every caller of this module:

ElevenLabs' voice pool was an open-ended library fetched live via API,
searched/scored by keyword overlap against a voice's own name/description/
labels -- the *voice itself* carried the character (accent, age, tone).
Gemini TTS instead ships exactly 30 FIXED prebuilt voices (VOICE_POOL
below), each just a name + a one-word style adjective + an (unofficial,
see caveat below) gender -- there is no live "list voices" endpoint and
no way to add more. What Gemini does instead, per its own docs, is let
you steer accent/tone/pace/style through the *prompt text itself* at
synthesis time (director's-note style: "Accent: Southern California
valley girl", "[whispers]", "Say cheerfully: ..."). So the character now
lives in the prompt, not in which fixed voice you pick.

CONSEQUENCE THAT MATTERS FOR CALLERS: with ElevenLabs, only the voice_id
needed to be persisted and replayed -- casting was a one-time lookup, and
every later /voice/speak call just needed that id. With Gemini, the
*voice_description* Granite drafted at casting time must ALSO be
persisted and re-sent on every single synthesize() call from here on
(including ordinary chat-reply playback, not just the casting preview) --
it's what makes the fixed voice actually sound like this character
instead of a flat, undirected read of that voice's default. main.py's
speak_as_character() passes asset["voiceDescription"] into synthesize()
for exactly this reason; don't strip that down to just voice_id if this
file is touched again later.

GENDER CAVEAT: ElevenLabs exposed an actual `labels.gender` field per
voice, straight from the API -- authoritative. Gemini's docs do not
publish gender for its 30 voices at all; VOICE_POOL's "gender" values
below are a best-effort mapping compiled from third-party listings
(cross-referencing the voices' one-word style adjectives against
independent write-ups), not something Google states outright. Treat this
the same way this project treats every other "small model / unverified
external claim" -- probably right, but if a specific pick ever sounds
wrong for its assigned gender, that's this mapping being imperfect, not
the filtering logic being broken. The existing hard-filter-then-score
design (see _pick_voice) is unchanged in shape from the ElevenLabs
version; only the pool and its metadata source changed.

Audio comes back from Gemini as raw PCM (mono, 16-bit, 24kHz) inside a
base64 field, NOT a ready-to-play file the way ElevenLabs' MP3 response
was -- _pcm_to_wav() wraps it in a minimal WAV container server-side so
the existing frontend `<audio>` / Response(media_type=...) plumbing needs
only a mime-type string change (audio/mpeg -> audio/wav), not a rewrite.
This exact request/response shape (generateContent + responseModalities:
["AUDIO"] + speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, raw
PCM back) was confirmed live against Laura's own key and account before
this file was written -- see the chat transcript from this session for
the verification curl + the WAV file she confirmed played back as real
speech.

MODEL FALLBACK CHAIN (added round 9, after Laura hit a real 429 mid-demo-
prep): Gemini's free tier rate-limits each TTS model separately and, per
Laura's own AI Studio dashboard screenshot, startlingly low --
gemini-2.5-flash-preview-tts showed RPD 10/day and RPM 3/min, and she'd
already gone over (12/10) from ordinary casting + chat testing alone, not
even a real demo run. TTS_MODEL_CHAIN below tries each of Gemini's three
TTS-capable models in turn (same sticky-"last good model"-first pattern as
watsonx.py's MODEL_CHAIN, kept deliberately simple rather than retrying
the SAME model twice on failure the way watsonx.py does -- a 429 is a hard
daily quota signal here, not a transient blip, so retrying the same model
would just waste one more count against an already-exhausted allowance).
This doesn't remove the ceiling, it just means three separate small
buckets instead of one -- if all three are exhausted the caller (main.py)
still raises and the frontend still falls back to Web Speech, exactly as
before. Whether gemini-2.5-pro-preview-tts / gemini-3.1-flash-tts-preview
have equally low or different free-tier limits is NOT independently
confirmed (Google's own rate-limits doc page doesn't publish exact
interactive numbers, only batch-API figures) -- Laura's AI Studio
dashboard ("Compare tiers" button, same page as her screenshot) is the
authoritative source if this needs re-checking. The only way to actually
raise these ceilings, not just spread load across models, is enabling
billing on the underlying Google Cloud project (Tier 1+) -- that's Laura's
financial call to make, not something this session should do on its own.

Credentials (GEMINI_API_KEY) live only here; the browser never sees them
-- same rule as watsonx.py and the old ELEVENLABS_API_KEY. Mirrors
watsonx.py's shape: a small httpx.AsyncClient wrapper per call, non-2xx
or network failure raises a plain RuntimeError, and the caller (main.py)
is responsible for turning that into a response the frontend recognizes
as "fall back to Web Speech" rather than letting the chat break.

ELEVENLABS_API_KEY is deliberately left in .env (unused by this file) as
a fallback per the migration decision, until this Gemini path has been
confirmed working end-to-end via Laura's own npm run dev.
"""

import base64
import io
import os
import random
import re
import wave

import httpx
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_BASE = "https://generativelanguage.googleapis.com"

# Confirmed live against Laura's account this session (see module docstring).
# Tried in this order; each has its own separate free-tier quota, so a 429
# on one doesn't mean the others are exhausted too.
TTS_MODEL_CHAIN = [
    "gemini-2.5-flash-preview-tts",
    "gemini-2.5-pro-preview-tts",
    "gemini-3.1-flash-tts-preview",
]

_last_good_tts_model: str | None = None

# Gemini's 30 fixed prebuilt voices. "style" is Google's own one-word
# descriptor (from their docs); "gender" is a best-effort third-party
# mapping -- see the GENDER CAVEAT in this file's module docstring.
VOICE_POOL: list[dict] = [
    {"name": "Zephyr", "gender": "female", "style": "Bright"},
    {"name": "Puck", "gender": "male", "style": "Upbeat"},
    {"name": "Charon", "gender": "male", "style": "Informative"},
    {"name": "Kore", "gender": "female", "style": "Firm"},
    {"name": "Fenrir", "gender": "male", "style": "Excitable"},
    {"name": "Leda", "gender": "female", "style": "Youthful"},
    {"name": "Orus", "gender": "male", "style": "Firm"},
    {"name": "Aoede", "gender": "female", "style": "Breezy"},
    {"name": "Callirrhoe", "gender": "female", "style": "Easy-going"},
    {"name": "Autonoe", "gender": "female", "style": "Bright"},
    {"name": "Enceladus", "gender": "male", "style": "Breathy"},
    {"name": "Iapetus", "gender": "male", "style": "Clear"},
    {"name": "Umbriel", "gender": "male", "style": "Easy-going"},
    {"name": "Algieba", "gender": "male", "style": "Smooth"},
    {"name": "Despina", "gender": "female", "style": "Smooth"},
    {"name": "Erinome", "gender": "female", "style": "Clear"},
    {"name": "Algenib", "gender": "male", "style": "Gravelly"},
    {"name": "Rasalgethi", "gender": "male", "style": "Informative"},
    {"name": "Laomedeia", "gender": "female", "style": "Upbeat"},
    {"name": "Achernar", "gender": "female", "style": "Soft"},
    {"name": "Alnilam", "gender": "male", "style": "Firm"},
    {"name": "Schedar", "gender": "male", "style": "Even"},
    {"name": "Gacrux", "gender": "female", "style": "Mature"},
    {"name": "Pulcherrima", "gender": "male", "style": "Forward"},
    {"name": "Achird", "gender": "male", "style": "Friendly"},
    {"name": "Zubenelgenubi", "gender": "male", "style": "Casual"},
    {"name": "Vindemiatrix", "gender": "female", "style": "Gentle"},
    {"name": "Sadachbia", "gender": "male", "style": "Lively"},
    {"name": "Sadaltager", "gender": "male", "style": "Knowledgeable"},
    {"name": "Sulafat", "gender": "female", "style": "Warm"},
]


def voice_configured() -> bool:
    return bool(GEMINI_API_KEY)


def _pick_voice(description: str, exclude_names: list[str], gender: str | None = None) -> dict:
    """Filter to `gender` first (hard filter, same shape as the ElevenLabs
    version's labels.gender check -- see GENDER CAVEAT above for why this
    pool's gender values are less authoritative than ElevenLabs' were),
    then score the remaining candidates by keyword overlap between
    `description` and each voice's name + style word, and randomly pick
    among the top few so regenerating gives real variety instead of always
    the single best-scoring voice. Voices already shown this casting
    session (exclude_names) are skipped unless that would exclude every
    candidate, in which case repeats are allowed rather than erroring.
    Same escape hatch for the gender filter: if it would leave nothing to
    choose from, fall back to the ungendered set rather than failing."""
    exclude = set(exclude_names or [])
    pool = [v for v in VOICE_POOL if v["name"] not in exclude] or VOICE_POOL

    if gender in ("male", "female"):
        gendered = [v for v in pool if v["gender"] == gender]
        if gendered:
            pool = gendered

    words = [w for w in re.sub(r"[^a-z0-9 ]", " ", description.lower()).split() if len(w) > 3]

    def score(v: dict) -> int:
        text = f"{v['name']} {v['style']}".lower()
        return sum(1 for w in words if w in text)

    scored = sorted(((score(v), v) for v in pool), key=lambda t: t[0], reverse=True)
    top = scored[0][0] if scored else 0
    tied = [v for s, v in scored if s >= max(top - 1, 0)] or [v for _, v in scored]
    return random.choice(tied[: min(8, len(tied))])


def _pcm_to_wav(raw: bytes) -> bytes:
    """Gemini TTS returns raw PCM (mono, 16-bit, 24kHz) -- wrap it in a
    minimal WAV container so it's a normal playable file for the frontend's
    <audio> element / data: URLs, same as ElevenLabs' MP3 response used to
    be. Sample format confirmed live this session (see module docstring)."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(raw)
    return buf.getvalue()


async def _call_tts(client: httpx.AsyncClient, model: str, voice_name: str, prompt_text: str) -> bytes:
    """One request against one TTS model. Returns raw PCM bytes. Raises
    RuntimeError on any non-2xx or unexpected response shape -- callers
    decide whether that means "try the next model" or "give up"."""
    resp = await client.post(
        f"{GEMINI_BASE}/v1beta/models/{model}:generateContent",
        params={"key": GEMINI_API_KEY},
        json={
            "contents": [{"parts": [{"text": prompt_text}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice_name}}
                },
            },
        },
        timeout=30,
    )
    if not resp.is_success:
        raise RuntimeError(f"{model} failed (status {resp.status_code}): {resp.text[:300]}")
    data = resp.json()
    try:
        part = data["candidates"][0]["content"]["parts"][0]["inlineData"]
        return base64.b64decode(part["data"])
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"{model} returned no audio: {str(data)[:300]}") from exc


async def synthesize(voice_name: str, style_description: str, text: str) -> bytes:
    """Speak `text` in `voice_name`, steered by `style_description` --
    unlike the ElevenLabs version, style/accent/tone is NOT baked into
    which fixed voice you pick, it has to be re-stated in the prompt on
    EVERY call (see module docstring's "CONSEQUENCE THAT MATTERS" note).
    Tries each model in TTS_MODEL_CHAIN in turn (see module docstring's
    "MODEL FALLBACK CHAIN" note) so one model's daily quota running out
    doesn't sink the whole feature. Returns WAV bytes. Raises only if
    EVERY model in the chain fails (bad key, bad voice name, network, all
    three quotas exhausted) -- callers catch this and fall back (Web
    Speech for chat replies; a plain error for casting)."""
    global _last_good_tts_model
    if not voice_configured():
        raise RuntimeError("GEMINI_API_KEY is not set")
    clean = " ".join(text.split()).strip()[:2000]
    if not clean:
        raise RuntimeError("no text to speak")
    style = (style_description or "").strip()[:400]
    prompt_text = (
        f'{style}. Speak the following line aloud, naturally and in character: "{clean}"'
        if style
        else clean
    )

    order = (
        [_last_good_tts_model] + [m for m in TTS_MODEL_CHAIN if m != _last_good_tts_model]
        if _last_good_tts_model
        else TTS_MODEL_CHAIN
    )
    last_error: Exception | None = None
    async with httpx.AsyncClient() as client:
        for model in order:
            try:
                raw_pcm = await _call_tts(client, model, voice_name, prompt_text)
                _last_good_tts_model = model
                return _pcm_to_wav(raw_pcm)
            except Exception as exc:
                last_error = exc
                continue
    raise RuntimeError(f"Gemini TTS synthesis failed on all {len(order)} models -- last error: {last_error}")


async def cast_voice_preview(description: str, exclude_names: list[str], preview_text: str, gender: str | None = None) -> dict:
    """Pick the best-matching fixed voice for `description` -- filtered to
    `gender` first when known, skipping exclude_names -- and synthesize one
    preview line in it, steered by `description`. voiceId and voiceName are
    the same value here (the Gemini voice name itself, e.g. "Kore") since
    there's no separate library id the way ElevenLabs had -- kept as two
    keys anyway so main.py/the frontend didn't need a contract change."""
    picked = _pick_voice(description, exclude_names, gender)
    audio = await synthesize(picked["name"], description, preview_text)
    return {
        "voiceId": picked["name"],
        "voiceName": picked["name"],
        "audioBase64": base64.b64encode(audio).decode("ascii"),
    }
