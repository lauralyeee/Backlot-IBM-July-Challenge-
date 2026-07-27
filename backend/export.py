"""
Feature 2 — Assets → Producible Output.

Compiles a writer-chosen subset of confirmed canon assets into a
production-usable Markdown document (character breakdown sheet, location
list, scene/beat outline, or pitch packet). Runs in the opposite direction
to ingestion.py: where ingestion turns raw text INTO assets, this module
turns existing assets INTO a formatted document.

Kept in its own module (rather than folded into generation.py or main.py)
so main.py's footprint stays a single import + route registration — the
team's agreed pattern for avoiding merge conflicts on shared files.

Output is always Markdown text (str), never JSON. No assets are written or
mutated — the endpoint is unconditionally read-only.

DOC_TYPES values:
  str  — pass as type_filter to db.list_assets() to pull only that asset type
  None — pull all asset types (type_filter=None means "no filter" in db.py)
"""

from __future__ import annotations

# Maps the docType key (as sent by the client) to the asset `type` value it
# pulls from the database.  None means "pull all types" — same semantics as
# db.list_assets(type_filter=None).
DOC_TYPES: dict[str, str | None] = {
    "characters": "character",
    "locations": "location",
    "beats": None,
    "pitch": None,
}

_DOC_LABELS: dict[str, str] = {
    "characters": "Character Breakdown Sheet",
    "locations": "Location List",
    "beats": "Scene/Beat Outline",
    "pitch": "Pitch Packet",
}

# Sampling caps for "pitch" — keeps the prompt tight and the output selective.
_PITCH_CAP: dict[str, int] = {
    "character": 8,
    "location": 6,
    "faction": 999,   # typically few — take all
    "event": 4,
}


# ── Era-order sort helper ─────────────────────────────────────────────────────

def _sort_by_era(assets: list[dict], world: dict) -> list[dict]:
    """Sort assets by their position in world["eras"] (the world's canonical
    chronological sequence), then preserve creation order within each era.
    Assets whose era isn't in world["eras"] sort last — they never crash."""
    eras = world.get("eras", [])
    return sorted(
        assets,
        key=lambda a: eras.index(a["era"]) if a.get("era") in eras else len(eras),
    )


# ── Pitch sampling helper ─────────────────────────────────────────────────────

def _pitch_sample(assets: list[dict]) -> list[dict]:
    """Apply per-type sampling caps for the Pitch Packet doc type.
    Any asset type not listed in _PITCH_CAP is excluded from the pitch entirely
    (e.g. raw lore dumps would bloat a pitch packet). Maintains order."""
    counts: dict[str, int] = {}
    out: list[dict] = []
    for a in assets:
        t = a.get("type", "")
        cap = _PITCH_CAP.get(t)
        if cap is None:
            continue  # type not relevant to a pitch
        n = counts.get(t, 0)
        if n < cap:
            out.append(a)
            counts[t] = n + 1
    return out


# ── Prompt builders ──────────────────────────────────────────────────────────

def compile_system_prompt(doc_type: str, world: dict) -> str:
    label = _DOC_LABELS.get(doc_type, doc_type)
    if doc_type == "beats":
        return (
            f'You are a story editor and script supervisor for the world "{world["name"]}". '
            f"Your task is to compile a {label} in Markdown that reassembles the provided "
            "canon entries into narrative order, moving through the world's eras in sequence. "
            "Event entries are the narrative backbone — use them as beat headings. "
            "Character, location, and lore entries are supporting context — weave them in "
            "under the beats where relevant. "
            "Do NOT invent plot points, scenes, or story developments not evidenced by the "
            "given canon entries. Only sequence and connect what is already there. "
            "Use # for era headings, ## for individual beats/events, and bullet points for "
            "supporting context. Output Markdown only — no preamble, no closing remarks."
        )
    if doc_type == "pitch":
        return (
            f"You are a writer's room executive putting together a pitch packet for "
            f'"{world["name"]}" aimed at a producer or collaborator audience. '
            "Write in a punchy, evocative tone — hooks and atmosphere over exhaustive detail. "
            "Structure the document as: a one-paragraph logline/world overview, then brief "
            "## sections for Key Characters, Key Locations, and Story Hooks (drawn from event "
            "entries if present). "
            "Only use information present in the provided entries — do not invent details. "
            "Keep it tight: this is a room-leaving document, not a bible. Output Markdown only."
        )
    # characters / locations — original behaviour unchanged
    return (
        f'You are a script supervisor and production coordinator for the world "{world["name"]}". '
        f"Your task is to compile a {label} in Markdown from the canon entries provided. "
        "Format the document with a clear Markdown header (##) for each entry. "
        "Under each header include the relevant production details as a short bulleted list. "
        "Only use information present in the provided entries — do not invent details not given. "
        "Do not add commentary, preamble, or closing remarks. Output Markdown only."
    )


def compile_user_prompt(doc_type: str, assets: list[dict], world: dict) -> str:
    if doc_type == "beats":
        sorted_assets = _sort_by_era(assets, world)
        eras = world.get("eras", [])
        has_events = any(a.get("type") == "event" for a in sorted_assets)
        title_line = _title_line(doc_type, world, len(sorted_assets))
        no_events_note = (
            "" if has_events else
            "\n\nNote: no dedicated 'event' assets exist yet in this world — "
            "produce an era-by-era outline from the available characters, locations, "
            "and lore entries instead.\n"
        )
        era_order_note = (
            f"Era order for this world (chronological): {' → '.join(eras)}.\n"
            if eras else ""
        )
        instruction = (
            f"Produce a Scene/Beat Outline. {era_order_note}"
            "Organise the entries below into narrative order by era, using event entries "
            "as beat headings and weaving character/location/lore entries in as context. "
            "Do not invent plot points not evidenced by the canon entries."
            f"{no_events_note}"
        )
        entries = "\n\n".join(_format_asset(a) for a in sorted_assets)
        return f"{instruction}\n\nDocument title: {title_line}\n\nCANON ENTRIES:\n\n{entries}"

    if doc_type == "pitch":
        sampled = _pitch_sample(assets)
        title_line = _title_line(doc_type, world, len(sampled))
        instruction = (
            "Produce a Pitch Packet. Write a tight, evocative overview for a producer audience: "
            "one-paragraph logline/world overview, then ## sections for Key Characters, "
            "Key Locations, and Story Hooks. Prioritise atmosphere and hooks over exhaustive "
            "detail. Only use information present in the entries below."
        )
        entries = "\n\n".join(_format_asset(a) for a in sampled)
        return f"{instruction}\n\nDocument title: {title_line}\n\nCANON ENTRIES (selected):\n\n{entries}"

    # characters / locations — original behaviour unchanged
    title_line = _title_line(doc_type, world, len(assets))
    if doc_type == "characters":
        instruction = (
            "Produce a Character Breakdown Sheet. For each character entry below, "
            "write a ## section with their name as the heading, then bullet points covering: "
            "description/backstory summary, voice or dialect notes if present, era, and faction. "
            "Keep each entry concise and production-ready."
        )
    else:  # locations
        instruction = (
            "Produce a Location List grouped by era. For each era, write a # heading with the era name, "
            "then a ## heading for each location in that era, with bullet points covering: "
            "description, and faction/controlling faction if present. "
            "Keep each entry concise and production-ready."
        )
    entries = "\n\n".join(_format_asset(a) for a in assets)
    return f"{instruction}\n\nDocument title: {title_line}\n\nCANON ENTRIES:\n\n{entries}"


def _format_asset(asset: dict) -> str:
    """Serialize one asset for the prompt — same fields as retrieval.canon_block
    but with a 400-char content cap (larger than canon_block's 220 chars since
    this output is meant to be read in full, not just used as grounding context)."""
    content = (asset.get("content") or "").strip()
    if len(content) > 400:
        content = content[:400].rsplit(" ", 1)[0] + "…"
    faction = asset.get("faction") or "—"
    return (
        f"Title: {asset.get('title', 'Untitled')}\n"
        f"Type: {asset.get('type', '')}\n"
        f"Era: {asset.get('era', '')}\n"
        f"Faction: {faction}\n"
        f"Content: {content}"
    )


# ── Title line helper ────────────────────────────────────────────────────────

def _title_line(doc_type: str, world: dict, count: int) -> str:
    label = _DOC_LABELS.get(doc_type, doc_type)
    return f"# {world['name']} — {label} ({count} {'entry' if count == 1 else 'entries'})"


# ── Offline fallback ─────────────────────────────────────────────────────────

def _offline_era_group(assets: list[dict], world: dict, include_type: bool = False) -> list[str]:
    """Shared helper: group assets by era in world order, return Markdown lines.
    Used by both the 'locations' and 'beats' offline branches."""
    eras = world.get("eras", [])
    sorted_assets = _sort_by_era(assets, world)
    # Build ordered era list preserving world era order, then appending any
    # unknown eras that appear in the data.
    seen_eras: list[str] = []
    for a in sorted_assets:
        era_key = (a.get("era") or "Unspecified").strip()
        if era_key not in seen_eras:
            seen_eras.append(era_key)

    by_era: dict[str, list[dict]] = {}
    for a in sorted_assets:
        era_key = (a.get("era") or "Unspecified").strip()
        by_era.setdefault(era_key, []).append(a)

    lines: list[str] = []
    for era_key in seen_eras:
        lines.append(f"# {era_key}")
        lines.append("")
        for a in by_era[era_key]:
            lines.append(f"## {a.get('title', 'Untitled')}")
            if include_type:
                lines.append(f"- **Type:** {a.get('type', '—')}")
            content = (a.get("content") or "").strip()
            if content:
                lines.append(f"- {content[:400]}")
            faction = (a.get("faction") or "—").strip()
            if faction and faction != "—":
                lines.append(f"- **Faction:** {faction}")
            lines.append("")
    return lines


def offline_compile(doc_type: str, assets: list[dict], world: dict) -> str:
    """Deterministic, no-LLM fallback: builds the same document directly from
    asset fields using plain Markdown headers and bullets. Returns a str (not a
    dict — unlike ingestion.py's offline fallback there is no structured JSON
    here, just markdown text) so the caller can drop it straight into the
    response without further processing."""
    lines: list[str] = [_title_line(doc_type, world, len(assets))]
    lines.append("")
    lines.append("> ⚠ Generated offline — watsonx was unreachable. Structure built directly from canon fields.")
    lines.append("")

    if doc_type == "locations":
        lines.extend(_offline_era_group(assets, world, include_type=False))

    elif doc_type == "beats":
        # Mixed-type view — include type label so the writer can tell entries apart
        lines.extend(_offline_era_group(assets, world, include_type=True))

    elif doc_type == "pitch":
        # Apply the same sampling cap as the online path, then group by type
        sampled = _pitch_sample(assets)
        # Group by type for readability
        by_type: dict[str, list[dict]] = {}
        for a in sampled:
            by_type.setdefault(a.get("type", "other"), []).append(a)
        type_order = ["character", "location", "event", "faction"]
        for t in type_order:
            if t not in by_type:
                continue
            lines.append(f"# {t.capitalize()}s")
            lines.append("")
            for a in by_type[t]:
                lines.append(f"## {a.get('title', 'Untitled')}")
                content = (a.get("content") or "").strip()
                if content:
                    lines.append(f"- {content[:400]}")
                era = (a.get("era") or "").strip()
                if era:
                    lines.append(f"- **Era:** {era}")
                faction = (a.get("faction") or "—").strip()
                if faction and faction != "—":
                    lines.append(f"- **Faction:** {faction}")
                lines.append("")

    else:
        # characters — one section per entry (original behaviour)
        for a in assets:
            lines.append(f"## {a.get('title', 'Untitled')}")
            content = (a.get("content") or "").strip()
            if content:
                lines.append(f"- {content[:400]}")
            era = (a.get("era") or "").strip()
            if era:
                lines.append(f"- **Era:** {era}")
            faction = (a.get("faction") or "—").strip()
            if faction and faction != "—":
                lines.append(f"- **Faction:** {faction}")
            lines.append("")

    return "\n".join(lines)
