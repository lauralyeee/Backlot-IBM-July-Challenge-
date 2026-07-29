"""
3D character concept model generation.

Granite drafts a small set of body-shape morph parameters from a
character's canon sheet; a headless Blender + CharMorph subprocess applies
them to a CharMorph base mesh and exports a .glb. The base mesh is chosen
per-character by a cheap Granite gender classification, because CharMorph's
two best-supported bases have very different capabilities:

- Vitruvian (CC0): a multi-ethnicity/gender blend base whose packed UDIM
  textures can't be exported by Blender's glTF exporter (see the
  implementation plan doc for the full story), so it's exported with a flat
  single-tone "concept_skin" material -- geometry/build/proportions are
  real, texture is not. Used for male and unspecified-gender characters,
  where Vitruvian's Gender_Male/Gender_Female sliders and broad
  Age/BodyType/Race vocabulary matter more than skin texture.
- Antonia Polygon (CC-BY): an anatomically fixed-female base whose textures
  export cleanly through the same exporter, at the cost of a much larger
  file (uncompressed exports run ~128MB) and a completely different,
  female-only morph vocabulary (no Gender slider -- she just is one). Used
  for characters classified as female, where real skin texture is judged
  worth the size trade-off; export uses JPEG-compressed textures and Draco
  mesh compression to keep the file web-sized.

No male-appropriate real-texture base has been identified yet (Reom and
MB-Lab male are untested) -- male/unspecified characters stay on Vitruvian's
flat-material fallback for now.

Mirrors the shape of watsonx.py/ingestion.py: a couple of Granite "art
director" calls plus a subprocess pipeline, both best-effort with a safe
fallback path so a failure here never crashes the request thread --
model_status/model_error on the asset row is how the frontend finds out
what happened. Designed to run as a FastAPI BackgroundTask (see main.py's
/model3d/generate endpoint), so nothing here raises back to the caller.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path

import db
import watsonx as wx

BACKEND_DIR = Path(__file__).parent
BLENDER_SCRIPT = BACKEND_DIR / "blender_scripts" / "generate_character.py"
MODELS_DIR = BACKEND_DIR / "static" / "models"

BLENDER_PATH = os.environ.get("BLENDER_PATH", "/opt/homebrew/bin/blender")
GENERATION_TIMEOUT_SECONDS = int(os.environ.get("BLENDER_TIMEOUT_SECONDS", "300"))

# CharMorph's OWN internal enum identifiers for each base -- NOT guaranteed
# to match our lowercase routing labels used elsewhere in this module
# (model_source strings like "charmorph-vitruvian", ALLOWED_MORPH_KEYS
# selection, etc). CONFIRMED 2026-07-28 via a live Blender traceback
# ("enum \"vitruvian\" not found in (...)") that the real enum values are
# ('Vitruvian', 'antonia', 'mb_female', 'mb_male', 'reom') -- Vitruvian is
# capitalized, unlike the others, which is exactly why the first attempt
# at this routing failed: we were passing our own lowercase label straight
# through as the literal --base-model value. This maps our label to the
# exact string CharMorph's base_model property actually expects; only
# used right at the Blender CLI boundary in run_blender_export() below.
CHARMORPH_BASE_MODEL_VALUES = {
    "vitruvian": "Vitruvian",
    "antonia": "antonia",
}

# --- Vitruvian (CC0) morph keys -------------------------------------------
# CharMorph morph keys this pipeline is allowed to set on the Vitruvian base
# (Category_Name pattern -- every morph in CharMorph's UI list as
# "Category_Name" maps to a Blender property "prop_Category_Name").
# CONFIRMED 2026-07-28 against a real live generation's ALL_AVAILABLE_MORPHS
# log (151 total morphs exposed by this CharMorph/Vitruvian install) --
# every key below is a real, verified property name, not a guess. The full
# 151-name list also includes fine facial/detail sliders (Face_*, Nose_*,
# Jaw_*, Eyes_*, etc.) that are deliberately left out per the plan's own
# scope: this feature draws body FORM only (build/age/gender/proportions),
# not faces -- canon entries rarely describe facial structure precisely
# enough to drive those sliders meaningfully anyway. Chest_* (breast/
# areola/nipple sliders) are also deliberately excluded -- out of scope for
# a "concept" body-form viewer, and not something a text model should ever
# be setting from free-form canon text.
#
# generate_character.py still silently skips any key that somehow doesn't
# resolve to a real CharMorph property (hasattr guard), so this list can be
# safely extended later without risking a crash if a future CharMorph
# version renames something.
VITRUVIAN_MORPH_KEYS = [
    # Age
    "Age_Baby",
    "Age_Old",
    # Gender
    "Gender_Female",
    "Gender_Male",
    # Build / somatotype (Ecto=slim, Meso=muscular, Endo=stocky/rounder --
    # standard somatotype terms, easy for the model to reason about)
    "BodyType_Fat",
    "BodyType_Muscular",
    "BodyType_Lean",
    "BodyType_Emaciated",
    "BodyType_EctoMorph",
    "BodyType_MesoMorph",
    "BodyType_EndoMorph",
    "BodyType_LongProportions",
    # Race/ethnicity (CharMorph's own built-in categories)
    "Race_African",
    "Race_Bengali",
    "Race_EastAsian",
    "Race_Hispanic",
    "Race_Kannada",
    "Race_Marathi",
    "Race_MiddleEastern",
    "Race_Punjabi",
    "Race_Sinhalese",
    "Race_Tamil",
    "Race_Telegu",
    "Race_White",
    # Fantasy/supernatural traits -- only relevant if canon explicitly
    # describes something non-human (vampires, etc.)
    "Fantasy_CatEyes",
    "Fantasy_NoNose",
    "Fantasy_SharpTeeth",
    "Fantasy_SnakeTongue",
    "Fantasy_VampireTeeth",
]

VITRUVIAN_GUIDANCE = (
    "Guidance per category -- only include a key if the canon entry "
    "actually implies it, never guess:\n"
    '- Age_Baby / Age_Old: only for an infant/very young child, or an '
    "elderly/aged character.\n"
    '- Gender_Female / Gender_Male: only if the character\'s gender is '
    "stated or clearly implied.\n"
    "- BodyType_*: map the described build to the closest term -- "
    "Fat (heavyset), Muscular (built/athletic), Lean (toned/slim-fit), "
    "Emaciated (starved/skeletal), EctoMorph (naturally thin/lanky), "
    "MesoMorph (naturally muscular), EndoMorph (naturally stocky/"
    "rounded), LongProportions (unusually tall/elongated).\n"
    "- Race_*: only if ethnicity is explicitly stated or unambiguous "
    "from the canon text.\n"
    "- Fantasy_*: only if the character is explicitly non-human or "
    "supernatural in a way one of these describes (CatEyes, NoNose, "
    "SharpTeeth, SnakeTongue, VampireTeeth) -- never for ordinary "
    "human characters."
)

# --- Antonia Polygon (CC-BY) morph keys ------------------------------------
# Antonia is an anatomically fixed-female CharMorph base (no Gender
# slider), with a totally different morph naming scheme -- plain,
# space-separated names (not Category_Name), confirmed 2026-07-28 against a
# real `sorted(n[5:] for n in dir(wm.charmorphs) if n.startswith("prop_"))`
# dump the user pasted from Blender's own Python console. Curated down from
# ~250 available morphs to a small body-FORM-only vocabulary, matching the
# same scope decision as Vitruvian above -- no face sliders, and (unlike
# Vitruvian, where nothing anatomical is exposed at all) an explicit
# exclusion of every Breast/Nipple/Aureola/Genital/Labia/Mons pubis morph:
# out of scope for a concept body-form viewer, never something a text model
# should be setting from free-form canon text.
ANTONIA_MORPH_KEYS = [
    "Athletic",
    "Athletic body only",
    "Chubby",
    "Chubby body only",
    "Thin",
    "Thin body only",
    "Old",
    "Old body only",
    "Young",
    "Young body only",
    "Petite",
    "Petite body only",
    "Hourglass",
    "Pear",
    "Neanderthal body only",
]

ANTONIA_GUIDANCE = (
    "Guidance -- only include a key if the canon entry actually implies "
    "it, never guess. Antonia is a fixed-female base, so there is no "
    "gender slider to set.\n"
    "- Athletic / Chubby / Thin / Old / Young / Petite: map the "
    "described build or age to the closest term. Each has a plain "
    'version and a "<Name> body only" version that applies the same '
    "shape to the body while leaving the face unaffected -- prefer the "
    "plain version by default, and only add the \"body only\" variant "
    "alongside it for an especially pronounced build.\n"
    "- Hourglass / Pear: overall body silhouette, only meaningful "
    "alongside a body type above -- Hourglass for a balanced/curvy "
    "waist-to-hip ratio, Pear for hips notably wider than the "
    "shoulders.\n"
    '- Neanderthal body only: an unusually robust, heavy-boned, '
    "primitive-looking build -- only for characters explicitly "
    "described that way."
)

_PARAM_SYSTEM_PROMPT = (
    "You are a technical artist converting a character's canon description "
    "into body-shape sliders for a 3D base mesh. This is NOT a costume or "
    "face generator -- only body build, age, gender presentation, and "
    "proportions. Output must be a single JSON object and nothing else -- "
    "no explanation, no markdown. Begin your response with { and end with }."
)


def _param_user_prompt(asset: dict, allowed_keys: list[str], guidance: str) -> str:
    allowed = ", ".join(allowed_keys)
    return (
        f"Character: {asset['title']}\n"
        f"Canon entry: {asset['content']}\n\n"
        "Return a JSON object mapping zero or more of these exact slider "
        f"keys to a float between 0.0 and 1.0 (0 = not present, 1 = fully "
        f"present): {allowed}.\n"
        f"{guidance}\n"
        "It is completely fine, and expected for many characters, to "
        "return an empty object {}. Begin your response with { and end "
        "with }."
    )


def _sanitize_params(raw: dict, allowed_keys: list[str]) -> dict:
    out = {}
    if not isinstance(raw, dict):
        return out
    for key in allowed_keys:
        if key in raw:
            try:
                v = float(raw[key])
            except (TypeError, ValueError):
                continue
            out[key] = max(0.0, min(1.0, v))
    return out


async def draft_params(asset: dict, allowed_keys: list[str], guidance: str) -> tuple[dict, bool]:
    """Have Granite draft morph params from the character sheet, against
    whichever base mesh's key vocabulary is passed in. Returns (params,
    offline) -- offline=True means the empty-dict fallback was used (the
    base mesh's neutral default body), never a hard failure."""
    try:
        text = await wx.generate(
            _PARAM_SYSTEM_PROMPT,
            _param_user_prompt(asset, allowed_keys, guidance),
            max_tokens=200,
        )
        raw = wx.parse_json(text)
        return _sanitize_params(raw, allowed_keys), False
    except Exception:
        return {}, True


async def classify_gender(asset: dict) -> str:
    """Cheap Granite call deciding which base mesh a character routes to.
    Returns exactly "female", "male", or "unspecified" -- anything else
    (a parse miss, an API error) falls back to "unspecified", which keeps
    the character on the Vitruvian path rather than misrouting it to
    Antonia's fixed-female base.

    Confirmed live 2026-07-28 (two regenerations in a row, both clearly
    female-coded characters via "she"/"her" pronouns throughout their
    canon text): the earlier "classify this character's gender
    presentation" phrasing was NOT truncating -- the model was replying
    with the complete, correctly-formatted word "unspecified" both times.
    That's a values judgment call a safety-tuned chat model tends to hedge
    on by defaulting to neutral, even with clear pronoun evidence right in
    front of it. Reframed as a mechanical pronoun-detection task instead
    (not an identity judgment) -- models are much less likely to hedge on
    "which pronoun does this text use" than on "what is this character's
    gender."."""
    try:
        raw = await wx.generate(
            "",
            "Read the canon entry below and identify which pronoun it uses "
            "for this character, based on the words actually used in the "
            "text (she/her, he/him, or they/other/no pronoun used). Reply "
            "with exactly one word: she, he, or unclear. Reply with that "
            "single word only.\n\n"
            f"Character: {asset['title']}\nCanon entry: {asset['content']}",
            max_tokens=6,
        )
        word = "".join(c for c in raw.strip().lower() if c.isalpha())
        print(f"[model3d] classify_gender raw reply={raw!r} cleaned_word={word!r}")
        if word == "she":
            return "female"
        if word == "he":
            return "male"
    except Exception as e:
        print(f"[model3d] classify_gender FAILED: {e!r}")
    return "unspecified"


async def run_blender_export(asset_id: int, params: dict, base_model: str) -> tuple[bool, str]:
    """Launch the headless Blender/CharMorph subprocess against the given
    base_model ("vitruvian" or "antonia"). Returns (ok, detail) -- detail is
    the served /models/... path on success, or an error message on failure.
    Runs off the request thread (asyncio subprocess), and is itself called
    from a FastAPI BackgroundTask so it never blocks a request.
    """
    output_path = MODELS_DIR / f"{asset_id}.glb"
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    cmd = [
        BLENDER_PATH,
        "--background",
        # Without this, an unhandled Python exception inside the --python
        # script does NOT make Blender exit non-zero -- Blender prints the
        # traceback to stderr and quits normally (exit 0) by default.
        # CONFIRMED as the real cause of a 2026-07-28 "success but no
        # output file" failure: the script threw before its own first
        # print, Blender swallowed it, returncode was 0, and our
        # `if proc.returncode != 0` check below never fired -- the actual
        # traceback was silently lost (not even in model_error). This flag
        # makes Blender exit 1 on a script exception so that check works.
        "--python-exit-code", "1",
        "--python", str(BLENDER_SCRIPT),
        "--",
        "--params", json.dumps(params),
        "--output", str(output_path),
        "--base-model", CHARMORPH_BASE_MODEL_VALUES.get(base_model, base_model),
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=GENERATION_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return False, f"Blender did not finish within {GENERATION_TIMEOUT_SECONDS}s (killed)."
    except FileNotFoundError:
        return False, f"Blender executable not found at '{BLENDER_PATH}'. Set BLENDER_PATH in backend/.env."
    except Exception as exc:
        return False, f"Failed to launch Blender: {exc}"

    # Always echo BOTH of Blender's streams to the backend server's own
    # console (whatever terminal is running `uvicorn`), success or
    # failure. This is the only place generate_character.py's
    # ALL_AVAILABLE_MORPHS diagnostic line (the ground-truth list of every
    # real CharMorph slider name) ever surfaces. Printing stderr here too
    # (added 2026-07-28, after the --python-exit-code fix above) closes the
    # gap where a script-side traceback was previously captured by the
    # PIPE and never shown anywhere, success or failure.
    stdout_text = (stdout or b"").decode(errors="replace")
    stderr_text = (stderr or b"").decode(errors="replace")
    print(f"[model3d] Blender stdout for asset {asset_id} (base={base_model}):\n{stdout_text}")
    if stderr_text.strip():
        print(f"[model3d] Blender stderr for asset {asset_id} (base={base_model}):\n{stderr_text}")

    if proc.returncode != 0:
        tail = stderr_text[-1500:] or stdout_text[-1500:]
        return False, f"Blender exited with code {proc.returncode}: {tail}"

    if not output_path.exists() or output_path.stat().st_size == 0:
        tail = (stderr_text or stdout_text)[-1500:]
        return False, f"Blender reported success but produced no output file. output tail: {tail}"

    return True, f"/models/{asset_id}.glb"


async def generate_and_store(asset_id: int, asset: dict) -> None:
    """Full pipeline: classify gender, draft params against the matching
    base mesh's vocabulary, run Blender, update the DB row. Meant to be
    scheduled as a FastAPI BackgroundTask -- never raises; every outcome is
    written to the asset row so the frontend's status poll is the only
    thing that needs to know what happened."""
    try:
        gender = await classify_gender(asset)
        print(f"[model3d] asset {asset_id} classify_gender() -> {gender!r}")
        if gender == "female":
            base_model, allowed_keys, guidance = "antonia", ANTONIA_MORPH_KEYS, ANTONIA_GUIDANCE
        else:
            base_model, allowed_keys, guidance = "vitruvian", VITRUVIAN_MORPH_KEYS, VITRUVIAN_GUIDANCE

        params, _offline_params = await draft_params(asset, allowed_keys, guidance)
        ok, detail = await run_blender_export(asset_id, params, base_model)
        if ok:
            db.update_asset(asset_id, {
                "model_path": detail,
                "model_source": f"charmorph-{base_model}",
                "model_status": "ready",
                "model_error": None,
                "model_added_at": int(time.time() * 1000),
                "model_kind": "3d",
            })
        else:
            db.update_asset(asset_id, {
                "model_status": "failed",
                "model_error": detail[:2000],
            })
    except Exception as exc:
        db.update_asset(asset_id, {
            "model_status": "failed",
            "model_error": f"Unexpected error: {exc}"[:2000],
        })
