"""
Feature 1 — Script/Doc Ingestion → Auto-Breakdown.

Extracts structured worldbuilding elements (characters, locations, props,
timeline markers, relationships) from a raw block of pasted text (script,
treatment, outline, pitch doc) and normalizes them into the same shape as
a regular canon asset (title/type/era/faction/mood/content), so extracted
elements flow through the rest of the app (WorldBook, Timeline, Characters)
exactly like anything created by hand or by the Gap-Filling Engine.

Kept in its own module (rather than folded into generation.py or main.py)
so main.py's footprint stays a single import + route registration — the
team's agreed pattern for avoiding merge conflicts on shared files.
"""

from __future__ import annotations

import re
import time
import random

from generation import TYPES

# Extraction only ever produces these three asset types — "prop" isn't a
# first-class asset type in this app, so props are stored as "lore" entries
# (their content simply centers on the object rather than a person/place).
EXTRACT_TYPES = {"characters": "character", "locations": "location", "props": "lore"}


def extraction_system_prompt(world: dict) -> str:
    return (
        f'You are a script/document analyst for the world "{world["name"]}". '
        "Given raw text from a script, treatment, outline, or pitch document, "
        "extract the concrete worldbuilding elements it contains. "
        "Only extract what is actually present in the text — do not invent details, "
        "and do not pad short mentions into full-length canon entries. "
        "Output must be a single JSON object and nothing else — no explanation, no markdown. "
        "Begin your response with { and end with }."
    )


def extraction_user_prompt(text: str, world: dict) -> str:
    eras = "|".join(world.get("eras", [])) or "unspecified"
    return (
        "Read the following text and return a JSON object with exactly these keys:\n"
        '  "characters": array of {"title": name, "era": best-guess era ('
        f"{eras}), "
        '"faction": affiliation if stated or "—", "mood": one lowercase word for their '
        'overall tone, "content": 40-120 words covering their described traits, first '
        'appearance, and dialogue voice if evident},\n'
        '  "locations": array of {"title": name, "era": best-guess era (' + eras + '), '
        '"faction": controlling faction if stated or "—", "mood": one lowercase word, '
        '"content": 40-120 words covering any era/mood cues in the text},\n'
        '  "props": array of {"title": name, "era": best-guess era (' + eras + '), '
        '"faction": "—" unless clearly tied to one, "mood": one lowercase word, '
        '"content": 40-120 words on why the object has narrative weight (recurring or '
        'symbolically important — skip incidental objects)},\n'
        '  "timelineMarkers": array of {"phrase": the exact phrase found (e.g. "ten years '
        'later"), "resolvedEra": which of the world\'s eras (' + eras + ') it most likely maps to},\n'
        '  "relationships": array of {"a": name, "b": name, "context": short phrase on how '
        'they are connected (mentioned together, speak to each other, etc.)}\n'
        "Omit a category entirely (empty array) if the text has nothing for it. "
        "Begin your response with { and end with }.\n\n"
        f"TEXT:\n{text}"
    )


def _first(v, d):
    return v.strip() if isinstance(v, str) and v.strip() else d


def normalize_extracted_item(raw: dict, world: dict, type_: str) -> dict:
    """Same shape/defaults as generation.normalize_asset(), but for an
    extraction-category item with an explicit (non-model-chosen) type."""
    eras = world.get("eras", [])
    return {
        "id": int(time.time() * 1000) + random.randint(0, 999),
        "title": _first(raw.get("title"), "Unnamed entry"),
        "type": type_ if type_ in TYPES else "lore",
        "era": raw.get("era") if raw.get("era") in eras else (eras[0] if eras else ""),
        "faction": _first(raw.get("faction"), "—"),
        "mood": _first(raw.get("mood"), "neutral"),
        "content": _first(raw.get("content"), "No description was extracted."),
        "createdAt": int(time.time() * 1000),
    }


def normalize_extraction(raw: dict, world: dict) -> dict:
    """Validate/coerce the full extraction payload so malformed model output
    (missing keys, wrong types) can never crash the ingest endpoint."""
    out = {"characters": [], "locations": [], "props": [], "timelineMarkers": [], "relationships": []}
    for key in ("characters", "locations", "props"):
        items = raw.get(key)
        if isinstance(items, list):
            out[key] = [i for i in items if isinstance(i, dict)]

    markers = raw.get("timelineMarkers")
    if isinstance(markers, list):
        out["timelineMarkers"] = [
            {"phrase": _first(m.get("phrase"), ""), "resolvedEra": _first(m.get("resolvedEra"), "")}
            for m in markers
            if isinstance(m, dict) and _first(m.get("phrase"), "")
        ]

    rels = raw.get("relationships")
    if isinstance(rels, list):
        out["relationships"] = [
            {"a": _first(r.get("a"), ""), "b": _first(r.get("b"), ""), "context": _first(r.get("context"), "")}
            for r in rels
            if isinstance(r, dict) and _first(r.get("a"), "") and _first(r.get("b"), "")
        ]

    return out


# ── Offline fallback (mirrors generation.offline_asset) ─────────────────────

_CAPITALIZED_RUN = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b")
_TIMELINE_PHRASES = re.compile(
    r"\b(\d+\s+years?\s+(?:later|earlier|ago)|in the old \w+|the next (?:day|morning|year))\b",
    re.IGNORECASE,
)


def offline_extraction(text: str, world: dict) -> dict:
    """Best-effort local extraction when watsonx is unreachable — regex-based
    proper-noun spotting rather than any real NLP. Everything it produces
    lands as an unconfirmed asset anyway, so a rough draft here is safe;
    the writer reviews/approves before anything counts as canon."""
    names = []
    seen = set()
    for m in _CAPITALIZED_RUN.finditer(text):
        name = m.group(1).strip()
        key = name.lower()
        if key in seen or len(name) < 3:
            continue
        seen.add(key)
        names.append(name)

    eras = world.get("eras", [""])
    characters = [
        {"title": n, "era": eras[0], "faction": "—", "mood": "unclear",
         "content": f'Appears in the pasted text as "{n}". Drafted offline — reopen when the service is back.'}
        for n in names[:8]
    ]

    markers = [
        {"phrase": m.group(1), "resolvedEra": eras[0]}
        for m in _TIMELINE_PHRASES.finditer(text)
    ]

    return {
        "characters": characters,
        "locations": [],
        "props": [],
        "timelineMarkers": markers,
        "relationships": [],
        "offline": True,
    }
