"""
Gemini TTS voice module -- server-side.

Migrated from ElevenLabs, whose free tier blocked both the Voice Design
flow and library/community voices. Gemini ships 30 fixed prebuilt voices;
character comes from the *prompt text* at synthesis time, not the voice
choice, so voice_description must be persisted and resent on every
synthesize() call, not just voice_id (see speak_as_character() in
main.py) -- that's what makes the fixed voice sound like this character
instead of a flat default read.

VOICE_POOL's gender field is a best-effort mapping (Gemini doesn't
publish gender per voice); treat a wrong-sounding pick as a mapping
issue, not a filter bug.

Audio comes back as raw PCM, so _pcm_to_wav() wraps it in a WAV
container -- the frontend only needed a mime-type change, not a rewrite.

TTS_MODEL_CHAIN exists because Gemini's free tier rate-limits each TTS
model separately and low (seen: 10 requests/day on one model). It tries
each of the three TTS models once in turn; if all are exhausted, main.py
still raises and the frontend falls back to Web Speech. Raising the
ceiling for real requires enabling billing on the Google Cloud project --
a product decision, not something to do from here.

GEMINI_API_KEY lives only server-side, same rule as watsonx.py.
ELEVENLABS_API_KEY stays in .env unused, kept as a fallback path.
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
