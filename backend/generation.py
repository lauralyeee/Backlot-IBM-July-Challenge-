"""
Server-side generation helpers — port of src/lib/generation.js.

Keeps prompt construction in one place so every API endpoint
that calls generate() gets consistent system prompts + schema.
"""

import re
import time
import random

TYPES = ["lore", "character", "location", "faction", "event"]


def persona_system(world: dict) -> str:
    roles = world.get("rolesFull") or []
    voices = "; and ".join(r["voice"] for r in roles)
    role_names = " and ".join(r["label"].lower() for r in roles)
    return (
        f'You are the resident {world["personaLabel"]} of the world "{world["name"]}". '
        f"Your audience is a {role_names}, so blend these needs: {voices}. "
        "You are the guardian of canon: everything you produce must stay consistent with "
        "the established canon provided and must never contradict it. "
        "Write original material in clear, accessible language."
    )


def schema_for(world: dict) -> str:
    eras = "|".join(world["eras"])
    types = "|".join(TYPES)
    return (
        "Output must be a single JSON object and nothing else — no explanation, no markdown. "
        f'Keys: "title" (short evocative name), "type" ({types}), "era" ({eras}), '
        '"faction" (an established faction or "—"), "mood" (one lowercase word), '
        '"content" (60-140 words). Begin your response with { and end with }.'
    )


def timeline_block(world: dict) -> str:
    """Render the world's eras -- in their canonical chronological order --
    with their descriptions, as a prompt block. This is what lets the model
    actually understand what each era IS instead of guessing from its name
    (the guessing produced wrong assumptions like characters aging between
    eras whose time relationship the model couldn't know)."""
    eras = world.get("eras", [])
    notes = world.get("eraNotes") or {}
    lines = []
    for i, e in enumerate(eras):
        note = (notes.get(e) or "").strip()
        lines.append(f"{i + 1}. {e}" + (f" — {note}" if note else ""))
    return (
        "WORLD TIMELINE (eras in chronological order; assume NOTHING about "
        "time spans, aging, decay, or technological change between eras "
        "beyond what these descriptions state):\n" + "\n".join(lines)
    )


def normalize_asset(raw: dict, world: dict, fallback_type: str | None = None) -> dict:
    def first(v, d):
        return v.strip() if isinstance(v, str) and v.strip() else d

    eras = world.get("eras", [])
    return {
        "id": int(time.time() * 1000) + random.randint(0, 999),
        "title": first(raw.get("title"), "Untitled entry"),
        "type": raw.get("type") if raw.get("type") in TYPES else (fallback_type or "lore"),
        "era": raw.get("era") if raw.get("era") in eras else (eras[0] if eras else ""),
        "faction": first(raw.get("faction"), "—"),
        "mood": first(raw.get("mood"), "neutral"),
        "content": first(raw.get("content"), "No description was returned."),
        "createdAt": int(time.time() * 1000),
    }



# ── Custom persona prompt builder ─────────────────────────────────────────────

def custom_persona_prompt(description: str, custom_eras: list[str] | None = None) -> tuple[str, str]:
    """Return (system_prompt, user_prompt) for generating a persona from a free-text
    description. If custom_eras is given (the writer typed their own timeline at
    onboarding), the model is told to use exactly those eras rather than inventing
    its own -- the writer's own timeline always wins over whatever the model would
    have picked."""
    system_prompt = (
        "You are a worldbuilding assistant. Given a brief description of a world concept, "
        "produce a structured persona object for a story world. "
        "Output must be a single JSON object and nothing else — no explanation, no markdown. "
        "Begin your response with { and end with }."
    )
    if custom_eras:
        eras_list = ", ".join(f'"{e}"' for e in custom_eras)
        eras_instruction = (
            f'  "eras": use exactly this era list, in this exact order, unchanged: [{eras_list}],\n'
        )
    else:
        eras_instruction = (
            '  "eras": an array of 3 to 6 era names as strings (evocative, short) — choose '
            "however many distinct chronological turning points this specific world concept "
            "naturally calls for, do not pad to a fixed count,\n"
        )
    user_prompt = (
        "Create a persona for this world concept:\n"
        f"{description}\n\n"
        "Return a JSON object with exactly these keys:\n"
        "  \"personaLabel\": a short evocative label for the world archetype (string, 2-5 words),\n"
        f"{eras_instruction}"
        "  \"nameIdeas\": an array of exactly 4 evocative world name suggestions as strings,\n"
        "  \"seed\": an array of 2-3 starter canon entries, each an object with keys: "
        "\"title\" (short name), \"type\" (one of: lore|character|location|faction|event), "
        "\"era\" (must match one of the eras you defined), "
        "\"faction\" (an established faction name or \"\\u2014\"), "
        "\"mood\" (one lowercase word), "
        "\"content\" (60-140 words of vivid, original description).\n"
        "Begin your response with { and end with }."
    )
    return system_prompt, user_prompt



def normalize_seed_entry(raw: dict, eras: list[str]) -> dict:
    """Like normalize_asset(), but for custom-persona seed entries generated
    before a world (and its eras) formally exist yet — takes the eras list
    directly instead of a world dict, and omits id/createdAt since the
    frontend assigns those when the world is actually created."""
    def first(v, d):
        return v.strip() if isinstance(v, str) and v.strip() else d

    return {
        "title": first(raw.get("title"), "Untitled entry"),
        "type": raw.get("type") if raw.get("type") in TYPES else "lore",
        "era": raw.get("era") if raw.get("era") in eras else (eras[0] if eras else ""),
        "faction": first(raw.get("faction"), "\u2014"),
        "mood": first(raw.get("mood"), "neutral"),
        "content": first(
            raw.get("content"),
            "A detail worth expanding once you're inside the world.",
        ),
    }


# ── Offline fallbacks (mirror of generation.js) ───────────────────────────

def _pick(arr, seed):
    return arr[abs(seed) % len(arr)]


def offline_asset(idea: str, world: dict, assets: list[dict], force_type: str | None = None) -> dict:
    seed = len(idea) + len(assets)
    related = _pick(assets, seed) if assets else None
    title = " ".join(idea.split("—")[0].split(".,")[0].split()[:5]).capitalize() or "New entry"
    openers = [
        "Established in the world's records as",
        "Known throughout these lands as",
        "Spoken of in the older accounts as",
    ]
    links = f" Its history runs alongside {related['title']}, and the two are rarely discussed apart." if related else ""
    is_char = bool(re.search(r"who|person|keeper|captain|king|queen|warden", idea, re.I))
    return {
        "id": int(time.time() * 1000) + random.randint(0, 999),
        "title": title,
        "type": force_type or ("character" if is_char else "location"),
        "era": _pick(world.get("eras", [""]), seed),
        "faction": related["faction"] if (related and related.get("faction") != "—") else "—",
        "mood": "unsettled",
        "content": f"{_pick(openers, seed)}: {idea}.{links} Drafted offline — reopen when the service is back.",
        "offline": True,
        "createdAt": int(time.time() * 1000),
    }


def offline_answer(question: str, assets: list[dict]) -> str:
    import re as _re
    words = [w for w in _re.sub(r"\W+", " ", question.lower()).split() if len(w) > 3]
    scored = sorted(
        [
            (a, sum(1 for w in words if w in (a["title"] + " " + a["content"]).lower()))
            for a in assets
        ],
        key=lambda x: x[1],
        reverse=True,
    )
    scored = [(a, s) for a, s in scored if s > 0]
    if not scored:
        return (
            "Nothing in your World Book covers that yet — "
            "which makes it a gap worth filling. (Answered offline, from your entries only.)"
        )
    top = "\n\n".join(f"{a['title']}: {a['content']}" for a, _ in scored[:2])
    return f"From your World Book:\n\n{top}\n\n(Answered offline, by searching your entries.)"


def offline_audit(assets: list[dict]) -> dict:
    issues = []
    seen: dict = {}
    for a in assets:
        key = a["title"].lower()
        if key in seen:
            issues.append({
                "severity": "low",
                "entries": [seen[key]["title"], a["title"]],
                "issue": "Two entries share the same name, which may confuse your canon.",
            })
        seen[key] = a
    factions = {a["title"] for a in assets if a["type"] == "faction"}
    for a in assets:
        if a["faction"] != "—" and a["faction"] not in factions and any(b["type"] == "faction" for b in assets):
            issues.append({
                "severity": "low",
                "entries": [a["title"]],
                "issue": f'Belongs to "{a["faction"]}", which has no entry of its own yet.',
            })
    return {"issues": issues, "offline": True}


