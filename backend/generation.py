"""
Server-side generation helpers — port of src/lib/generation.js.

Keeps prompt construction in one place so every API endpoint
that calls generate() gets consistent system prompts + schema.
"""

import re
import time
import random

# "faction" used to be a fixed asset type -- not every world has factions,
# or calls them that. Anything that doesn't fit the universal categories
# below now lands in "other", with the model (or the writer, via the
# World Book editor) supplying a per-entry label naming what it actually
# is (a Faction, a Clan, a Guild, ...) -- see schema_for() below.
TYPES = ["lore", "character", "location", "event", "other"]


def persona_system(world: dict) -> str:
    roles = world.get("rolesFull") or []
    voices = "; and ".join(r["voice"] for r in roles)
    role_names = " and ".join(r["label"].lower() for r in roles)
    return (
        f'You are the resident {world["personaLabel"]} of the world "{world["name"]}". '
        f"Your audience is a {role_names}, so blend these needs: {voices}. "
        "You are the guardian of canon: everything you produce must stay consistent with "
        "the established canon provided and must never contradict it. "
        "Match the tone, genre, and level of realism of this specific world -- do not "
        "default to fantasy, science-fiction, or mythic tropes unless this world's own "
        "persona and established canon actually call for them. "
        "Write original material in clear, accessible language."
        + (f" {premise_block(world)}" if premise_block(world) else "")
    )


def schema_for(world: dict, title_style: str | None = None) -> str:
    eras = "|".join(world["eras"])
    types = "|".join(TYPES)
    if title_style == "character":
        title_key = (
            '"title" (the character\'s name -- a plausible name this world\'s people '
            'would actually go by: a first name, full name, nickname, or an in-world '
            'epithet used the way a *name* is used, never an abstract poetic phrase '
            'that reads like a chapter or event title)'
        )
    else:
        title_key = '"title" (a concise, fitting name or heading for this entry)'
    return (
        "Output must be a single JSON object and nothing else — no explanation, no markdown. "
        f'Keys: {title_key}, "type" ({types} -- pick "other" when the entry is a kind of '
        'thing this world clearly has (a faction, clan, guild, organization, deity, etc.) '
        'that isn\'t lore/character/location/event), "typeLabel" (ONLY when type is '
        '"other": a short 1-3 word name for what kind of thing this is, in this world\'s '
        'own vocabulary, e.g. "Faction", "Clan", "Guild", "Deity" -- otherwise ""), '
        f'"era" ({eras}), '
        '"faction" (an established faction or "—"), "mood" (one lowercase word), '
        '"content" (60-140 words). Begin your response with { and end with }.'
    )


def premise_block(world: dict) -> str:
    """Render the world's short premise as a prompt fragment, or "" if none
    is set. Every world gets *some* description (a preset persona's own
    blurb, or the writer's own custom-world text) captured once at onboarding
    -- this is what lets every generation call, and in-character chat, know
    what the world is actually about instead of only its name and persona."""
    desc = (world.get("description") or "").strip()
    if not desc:
        return ""
    return f"WORLD PREMISE: {desc}"


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
        "typeLabel": first(raw.get("typeLabel"), ""),
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
        "Stay strictly within the genre, tone, and level of realism the description "
        "implies -- if it reads as contemporary, realistic, romance, drama, thriller, or "
        "historical fiction, keep everything grounded in that; do not add fantasy, "
        "science-fiction, magic, or supernatural elements unless the description itself "
        "calls for them. "
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
        "  \"personaLabel\": a short label naming this story's actual genre/premise, in "
        "the same register as the description (string, 2-5 words) -- do not invent a "
        "fantasy or game-like archetype unless the description itself is fantasy or "
        "game-like. The description may compare itself to real, existing shows, films, "
        "or books -- if so, do NOT quote or name those real titles in this label. "
        "Describe the genre, tone, and premise in your own original words instead "
        "(for example, \"a mix of Killing Eve and Fleabag\" should become something "
        "like \"Dark-Comedy Crime Thriller\", not \"Killing Eve Fleabag Thriller\"),\n"
        f"{eras_instruction}"
        "  \"nameIdeas\": an array of exactly 4 fitting world name suggestions, matching "
        "the description's own genre, as strings,\n"
        "  \"ideas\": an array of 4-6 starter-idea objects for this world, each with keys "
        "\"label\" (a short 2-5 word tag) and \"text\" (one sentence pitching a scene, "
        "conflict, or character seed a writer could expand into a full entry) -- these "
        "power a \"starter ideas\" picker, so make each one a genuinely usable prompt, "
        "not a restatement of the premise,\n"
        "  \"seed\": an array of 2-3 starter canon entries, each an object with keys: "
        "\"title\" (short name), \"type\" (one of: lore|character|location|event|other -- "
        "use \"other\" for a faction/clan/guild/organization/deity/etc. that doesn't fit "
        "the rest), \"typeLabel\" (ONLY when type is \"other\": a short 1-3 word name for "
        "what kind of thing this is, e.g. \"Faction\", \"Clan\" -- otherwise \"\"), "
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
        "typeLabel": first(raw.get("typeLabel"), ""),
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


def offline_asset(idea: str, world: dict, assets: list[dict], force_type: str | None = None, force_type_label: str | None = None) -> dict:
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
        "typeLabel": force_type_label or "",
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
            other = seen[key]
            if other["type"] == a["type"]:
                issue = "Two entries share the same name, which may confuse your canon."
            else:
                issue = (
                    f'"{a["title"]}" is used by both a {other["type"]} and a {a["type"]} '
                    "— easy to mix up when picking an entry elsewhere in the app."
                )
            issues.append({
                "severity": "low",
                "entries": [other["title"], a["title"]],
                "issue": issue,
            })
        seen[key] = a
    # "faction" used to be a dedicated type; now any "other"-typed entry
    # can stand in for it (a Faction/Clan/Guild/etc.), so this checks by
    # title match across all entries rather than one hardcoded type.
    titles = {a["title"] for a in assets}
    has_org_entries = any(b["type"] == "other" for b in assets)
    for a in assets:
        if a["faction"] != "—" and a["faction"] not in titles and has_org_entries:
            issues.append({
                "severity": "low",
                "entries": [a["title"]],
                "issue": f'Belongs to "{a["faction"]}", which has no entry of its own yet.',
            })
    return {"issues": issues, "offline": True}


