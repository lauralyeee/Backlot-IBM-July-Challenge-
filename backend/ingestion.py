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


# ── File conversion (Docling for PDF/DOCX, direct decode for plain text) ─────
#
# Feeds the SAME extraction pipeline below (extraction_system_prompt/
# extraction_user_prompt, normalize_extraction) as the paste path -- both
# paths end up as plain text, which main.py's /ingest/file route hands to
# the shared staging helper exactly like pasted text from /ingest. No
# changes to the review/commit flow are needed.

# PDF/DOCX need Docling to pull text out of a binary layout. TXT and Fountain
# (a plain-text screenplay markup format -- scene headings, character cues,
# and dialogue are just conventionally-capitalized lines, no binary encoding
# involved) are already text, so they're decoded directly instead of being
# routed through Docling at all. Mirrored client-side in Import.jsx as
# DOCLING_EXTENSIONS / PLAIN_TEXT_EXTENSIONS.
DOCLING_UPLOAD_EXTENSIONS = {".pdf", ".docx"}
PLAIN_TEXT_UPLOAD_EXTENSIONS = {".txt", ".fountain"}
SUPPORTED_UPLOAD_EXTENSIONS = DOCLING_UPLOAD_EXTENSIONS | PLAIN_TEXT_UPLOAD_EXTENSIONS

_converter_instance = None


def _get_converter():
    """Lazily build (and cache) the Docling converter. Importing here --
    not at module load -- means a backend without docling installed yet
    (e.g. before `pip install docling` has been run locally) can still serve
    every other function in this module untouched; only a call that actually
    needs Docling pays the import cost or surfaces the ImportError.
    """
    global _converter_instance
    if _converter_instance is None:
        try:
            from docling.document_converter import DocumentConverter
        except ImportError as e:
            raise RuntimeError(
                "Docling isn't installed on this backend. Run `pip install "
                "docling` (see backend/requirements.txt) and restart the server."
            ) from e
        # Converter init loads Docling's layout/OCR models -- expensive (can be
        # several seconds, and downloads models on first run). Built once and
        # reused across requests rather than per-call.
        _converter_instance = DocumentConverter()
    return _converter_instance


def convert_upload_to_text(filename: str, data: bytes) -> str:
    """Convert an uploaded PDF/DOCX's raw bytes to markdown text via Docling.

    Raises RuntimeError with a user-facing message on any failure (missing
    dependency or unparsable file) -- the caller (main.py's /ingest/file
    route) turns that into a 4xx for the UI rather than a raw 500.
    """
    from docling.datamodel.base_models import DocumentStream
    import io

    converter = _get_converter()  # raises RuntimeError early if not installed
    stream = DocumentStream(name=filename, stream=io.BytesIO(data))
    try:
        result = converter.convert(stream)
    except Exception as e:
        raise RuntimeError(f"Docling couldn't parse this file: {e}") from e

    return result.document.export_to_markdown()


def decode_plain_text_upload(data: bytes) -> str:
    """Decode a .txt/.fountain upload's raw bytes directly -- no Docling
    involved, since both formats are already plain text. Falls back to
    latin-1 (which never raises) if the file isn't valid UTF-8, rather than
    failing the whole extraction over an encoding mismatch in a screenplay
    file that likely came from an older tool.
    """
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1")


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


def normalize_extracted_item(raw: dict, world: dict, type_: str, index: int = 0) -> dict:
    """Same shape/defaults as generation.normalize_asset(), but for an
    extraction-category item with an explicit (non-model-chosen) type.

    `index` is added to the generated id so a single extraction can't produce
    two items with the same id — these ids are handed to the client as React
    keys before anything is persisted, so uniqueness matters even for items
    the user never approves.
    """
    eras = world.get("eras", [])
    now = int(time.time() * 1000)
    return {
        "id": now + index * 1000 + random.randint(0, 999),
        "title": _first(raw.get("title"), "Unnamed entry"),
        # `type_` always comes from EXTRACT_TYPES (character/location/lore) in
        # practice, so this branch shouldn't fire today -- but if extraction
        # is ever extended with a category that isn't one of the World Book's
        # real asset types, it lands in "other" rather than being silently
        # mislabeled as "lore".
        "type": type_ if type_ in TYPES else "other",
        "era": raw.get("era") if raw.get("era") in eras else (eras[0] if eras else ""),
        "faction": _first(raw.get("faction"), "—"),
        "mood": _first(raw.get("mood"), "neutral"),
        "content": _first(raw.get("content"), "No description was extracted."),
        "createdAt": now,
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

# Negative lookahead on a trailing apostrophe keeps contractions like "Don't"
# or "It's" from being sliced into a bare "Don" / "It".
_CAPITALIZED_RUN = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b(?!['’]\w)")
_TIMELINE_PHRASES = re.compile(
    r"\b(\d+\s+years?\s+(?:later|earlier|ago)|in the old \w+|the next (?:day|morning|year))\b",
    re.IGNORECASE,
)

# Common words that end up capitalized at the start of a sentence — pronouns,
# articles, conjunctions, prepositions, auxiliary verbs, question words — none
# of which are ever character/location names. Filtered by exact word (not
# substring), case-insensitive, so this only ever drops these specific words.
_STOPWORDS = frozenset({
    "i", "he", "she", "his", "her", "him", "hers", "they", "their", "theirs", "them",
    "we", "us", "our", "ours", "you", "your", "yours", "it", "its", "this", "that",
    "these", "those", "the", "a", "an", "and", "but", "or", "nor", "so", "yet", "for",
    "through", "with", "without", "from", "when", "while", "then", "now", "after",
    "before", "during", "until", "because", "although", "though", "if", "as", "at",
    "by", "in", "on", "of", "to", "up", "down", "out", "over", "under", "about",
    "above", "below", "between", "among", "into", "onto", "upon", "not", "no", "yes",
    "don", "doesn", "didn", "wasn", "weren", "isn", "aren", "won", "can", "could",
    "should", "would", "will", "shall", "may", "might", "must", "also", "just",
    "only", "even", "still", "again", "here", "there", "where", "why", "how",
    "what", "who", "whom", "whose", "which", "there's", "here's",
})


def offline_extraction(text: str, world: dict) -> dict:
    """Best-effort local extraction when watsonx is unreachable — regex-based
    proper-noun spotting rather than any real NLP. Everything it produces
    lands as an unconfirmed asset anyway, so a rough draft here is safe;
    the writer reviews/approves before anything counts as canon. Still worth
    filtering out the obvious junk (pronouns, articles, contractions) so the
    review queue isn't swamped with words that are never names."""
    counts: dict = {}
    first_seen: dict = {}
    for m in _CAPITALIZED_RUN.finditer(text):
        name = m.group(1).strip()
        key = name.lower()
        if len(name) < 3 or key in _STOPWORDS:
            continue
        counts[key] = counts.get(key, 0) + 1
        first_seen.setdefault(key, name)

    names = [
        first_seen[key]
        for key, n in counts.items()
        # Multi-word runs are strong signals on their own; single words need
        # to recur at least twice to count as a probable recurring name.
        if (" " in first_seen[key]) or n >= 2
    ]

    eras = world.get("eras", [""])
    characters = [
        {"title": n, "era": eras[0], "faction": "—", "mood": "unclear",
         "content": f'Appears in the pasted text as "{n}". Drafted offline, reopen when the service is back.'}
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
