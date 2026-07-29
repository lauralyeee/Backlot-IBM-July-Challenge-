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


# ── Docling file conversion (PDF/DOCX -> markdown) ───────────────────────────
#
# Feeds the SAME extraction pipeline below (extraction_system_prompt/
# extraction_user_prompt, normalize_extraction) as the paste path -- Docling
# only ever produces markdown text, which main.py's /ingest/file route hands
# to the shared staging helper exactly like pasted text from /ingest. No
# changes to the review/commit flow are needed.

SUPPORTED_UPLOAD_EXTENSIONS = {".pdf", ".docx", ".txt", ".fountain"}

# .txt/.fountain need no Docling conversion at all -- they're already plain
# text, so /ingest/file's route branches on this set and reads the upload
# directly instead of routing it through Docling.
PLAIN_TEXT_UPLOAD_EXTENSIONS = {".txt", ".fountain"}

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
        'later"), "resolvedEra": which of the world\'s eras (' + eras + ') it most likely maps to, '
        '"summary": 1-2 sentences on what actually happens at/around this moment in the text},\n'
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
        "type": type_ if type_ in TYPES else "lore",
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
            {
                "phrase": _first(m.get("phrase"), ""),
                "resolvedEra": _first(m.get("resolvedEra"), ""),
                "summary": _first(m.get("summary"), ""),
            }
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


def normalize_timeline_marker(raw: dict, world: dict, index: int = 0) -> dict:
    """Reshape a raw {"phrase", "resolvedEra", "summary"} timeline marker into
    the same normalized-item shape as characters/locations/props, so markers
    can flow through the exact same proposed/matches diff as everything else
    (asset type "event") instead of needing their own inert display path."""
    phrase = _first(raw.get("phrase"), "Unspecified moment")
    summary = _first(raw.get("summary"), "")
    content = summary or f'Marked in the source document as "{phrase}".'
    shaped = {
        "title": phrase,
        "era": raw.get("resolvedEra"),
        "faction": "—",
        "mood": "neutral",
        "content": content,
    }
    return normalize_extracted_item(shaped, world, "event", index)


# ── Chunking for long documents ──────────────────────────────────────────────
#
# A single extraction call has a fixed max_tokens ceiling, so a genuinely
# long script/treatment either gets silently truncated by the model or blows
# past what it can reliably attend to in one pass. chunk_text() splits long
# text into overlapping windows (preferring scene-heading boundaries, since
# this app's primary input is screenplay-shaped text), each of which is run
# through the same extraction prompt independently; merge_extractions()
# unions the per-chunk results back into one payload, deduping anything that
# got picked up in more than one overlapping chunk.

MAX_CHUNK_CHARS = 6000
CHUNK_OVERLAP = 300
_SCENE_HEADING = re.compile(r"^\s*(INT|EXT|INT[/.\-]EXT|I/E)[.\s]", re.IGNORECASE | re.MULTILINE)


def _window_split(text: str, max_chars: int, overlap: int) -> list[str]:
    """Hard character windows with overlap — last resort when there are no
    scene headings or paragraph breaks to split on."""
    if len(text) <= max_chars:
        return [text] if text.strip() else []
    chunks, step = [], max(max_chars - overlap, 1)
    for start in range(0, len(text), step):
        chunk = text[start : start + max_chars]
        if chunk.strip():
            chunks.append(chunk)
        if start + max_chars >= len(text):
            break
    return chunks


def _add_overlap(chunks: list[str], overlap: int) -> list[str]:
    """Prepend a tail of the previous chunk to each subsequent one so context
    straddling a chunk boundary (e.g. a relationship spoken across a scene
    break) isn't lost entirely to one side."""
    if len(chunks) <= 1 or overlap <= 0:
        return chunks
    out = [chunks[0]]
    for i in range(1, len(chunks)):
        out.append(chunks[i - 1][-overlap:] + chunks[i])
    return out


def chunk_text(text: str, max_chars: int = MAX_CHUNK_CHARS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into chunks for per-chunk extraction. Prefers scene-heading
    (INT./EXT.) boundaries since script-shaped input is the primary use
    case; falls back to paragraph breaks, then hard character windows.
    Text at or under max_chars is returned unchanged as a single chunk (the
    common case — most demo-length docs never chunk at all)."""
    text = text or ""
    if len(text) <= max_chars:
        return [text] if text.strip() else []

    headings = list(_SCENE_HEADING.finditer(text))
    if len(headings) >= 2:
        raw_chunks = []
        current = text[: headings[0].start()]
        for i, h in enumerate(headings):
            seg_end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
            segment = text[h.start():seg_end]
            if current and len(current) + len(segment) > max_chars:
                raw_chunks.append(current)
                current = segment
            else:
                current += segment
        if current:
            raw_chunks.append(current)
        # A single scene can still exceed max_chars on its own (rare, but
        # possible with a very long unbroken scene) — window-split just that
        # piece rather than the whole document.
        final = []
        for c in raw_chunks:
            final.extend([c] if len(c) <= max_chars * 1.4 else _window_split(c, max_chars, overlap))
        return _add_overlap(final, overlap)

    paragraphs = re.split(r"\n\s*\n", text)
    if len(paragraphs) >= 2:
        chunks, current = [], ""
        for p in paragraphs:
            if current and len(current) + len(p) + 2 > max_chars:
                chunks.append(current)
                current = p
            else:
                current = f"{current}\n\n{p}" if current else p
        if current:
            chunks.append(current)
        return _add_overlap(chunks, overlap)

    return _add_overlap(_window_split(text, max_chars, overlap), overlap)


def merge_extractions(extractions: list[dict]) -> dict:
    """Union a list of per-chunk normalize_extraction() outputs into one
    payload, deduping characters/locations/props by title, timeline markers
    by (phrase, resolvedEra), and relationships by (a, b, context) — all
    case-insensitive — so an entry mentioned in more than one overlapping
    chunk only surfaces once."""
    merged = {"characters": [], "locations": [], "props": [], "timelineMarkers": [], "relationships": []}
    seen_titles = {"characters": set(), "locations": set(), "props": set()}
    seen_markers: set = set()
    seen_rels: set = set()

    for extraction in extractions:
        for key in ("characters", "locations", "props"):
            for item in extraction.get(key, []):
                title_key = (item.get("title") or "").strip().lower()
                if not title_key or title_key in seen_titles[key]:
                    continue
                seen_titles[key].add(title_key)
                merged[key].append(item)
        for marker in extraction.get("timelineMarkers", []):
            marker_key = ((marker.get("phrase") or "").strip().lower(), (marker.get("resolvedEra") or "").strip().lower())
            if marker_key in seen_markers:
                continue
            seen_markers.add(marker_key)
            merged["timelineMarkers"].append(marker)
        for rel in extraction.get("relationships", []):
            rel_key = ((rel.get("a") or "").strip().lower(), (rel.get("b") or "").strip().lower(), (rel.get("context") or "").strip().lower())
            if rel_key in seen_rels:
                continue
            seen_rels.add(rel_key)
            merged["relationships"].append(rel)
    return merged


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
