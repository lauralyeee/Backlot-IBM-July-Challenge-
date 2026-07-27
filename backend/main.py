"""
AI Worldbuilding Co-Pilot — FastAPI backend

Endpoints:
  POST /api/worlds                     create world (+ bulk-seed assets)
  GET  /api/worlds/{id}                get world
  PATCH /api/worlds/{id}               update world metadata
  GET  /api/worlds/{id}/assets              list assets (optional ?type=)
  POST /api/worlds/{id}/assets              save a pre-built asset (used at onboarding seed)
  PATCH /api/worlds/{id}/assets/{aid}       edit title/content/era/faction/mood of an asset
  DELETE /api/worlds/{id}/assets/{aid}      delete an asset
  POST /api/worlds/{id}/generate       gap-fill / character / era-shift generation
  POST /api/worlds/{id}/audit          consistency audit
  POST /api/worlds/{id}/ask            Q&A (lore or character-in-character)
  POST /api/personas/custom            generate a persona from a free-text description
  POST /api/worlds/{id}/ingest                      script/doc → extracted proposals (read-only, Feature 1)
  POST /api/worlds/{id}/ingest/commit               persist writer-approved extracted entries
  POST /api/worlds/{id}/ingest/update/{asset_id}    overwrite an existing asset from a matched extraction
  POST /api/worlds/{id}/export         compile assets → Markdown document (read-only, Feature 2)
  POST /api/worlds/{id}/eras/rename    rename an era, cascading to every asset tagged with it
  POST /api/worlds/{id}/eras/remove    remove an era (optionally merging its assets into another)
  POST /api/worlds/{id}/eras/describe  AI-draft 1-2 sentence descriptions for eras that lack one
  POST /api/worlds/{id}/assets/{aid}/portrait   draft + store a visual portrait prompt/seed for an asset
  GET  /api/ping                       test watsonx connection
  GET  /api/models                     list available foundation models
"""

from __future__ import annotations

import os
import random
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from dotenv import load_dotenv
load_dotenv()

import db
import watsonx as wx
import retrieval as ret
import generation as gen
import ingestion as ing
import export as exp

# ── App lifecycle ────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Worldbuilding Co-Pilot API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ──────────────────────────────────────────────────────────────────

from lib.worldData import ROLES as _ROLES_DATA

_ROLES_MAP = {r["id"]: r for r in _ROLES_DATA}


def _enrich_world(world: dict) -> dict:
    """Attach rolesFull (same shape as JS worldData.ROLES) for prompt building."""
    world = dict(world)
    world["rolesFull"] = [_ROLES_MAP[r] for r in world.get("roles", []) if r in _ROLES_MAP]
    return world


def _require_world(world_id: str) -> dict:
    w = db.get_world(world_id)
    if not w:
        raise HTTPException(status_code=404, detail="World not found")
    return _enrich_world(w)


# ── Pydantic schemas ─────────────────────────────────────────────────────────

class WorldCreate(BaseModel):
    id: str
    name: str
    personaId: str
    personaLabel: str
    eras: list[str]
    eraNotes: dict = {}            # era name -> 1-2 sentence description
    ideas: list[dict]
    dialects: dict = {}
    roles: list[str]
    createdAt: int
    seed: list[dict] = []          # starter assets, inserted in the same call


class WorldPatch(BaseModel):
    name: str | None = None
    personaId: str | None = None
    personaLabel: str | None = None
    eras: list[str] | None = None
    eraNotes: dict | None = None
    ideas: list[dict] | None = None
    dialects: dict | None = None
    roles: list[str] | None = None


class AssetIn(BaseModel):
    id: int
    title: str
    type: str
    era: str
    faction: str = "—"
    mood: str = "neutral"
    content: str
    offline: bool = False
    createdAt: int


class GenerateRequest(BaseModel):
    mode: str                    # "expand" | "character" | "era_shift"
    fragment: str = ""           # the user's raw idea / era-shift subject content
    era: str = ""                # target era for era_shift
    subject_id: int | None = None  # asset id for era_shift
    force_type: str | None = None
    # Optional creator-specified character traits (mode == "character"):
    # keys gender / age / appearance / personality, all strings. Anything
    # provided becomes a hard requirement in the prompt; anything absent
    # stays AI-invented (the old behavior).
    traits: dict | None = None


class AskRequest(BaseModel):
    mode: str                    # "lore" | character asset id as string
    question: str
    history: list[dict] = []     # [{role, text}, …] for character chat


class AuditRequest(BaseModel):
    pass  # no body needed — uses all assets for the world


class CustomPersonaRequest(BaseModel):
    description: str
    customEras: list[str] | None = None


class EraRenameRequest(BaseModel):
    oldEra: str
    newEra: str


class EraRemoveRequest(BaseModel):
    era: str
    mergeInto: str | None = None


class EraDescribeRequest(BaseModel):
    era: str | None = None   # describe just this era; omit to fill all empty ones


class ExportRequest(BaseModel):
    docType: str
    era: str = ""
    faction: str = ""


class IngestRequest(BaseModel):
    text: str
    title: str = "Untitled document"


class DocumentIn(BaseModel):
    id: str
    title: str = "Untitled document"
    rawText: str = ""
    createdAt: int


class CommitRequest(BaseModel):
    document: DocumentIn
    assets: list[AssetIn] = []


class UpdateFromExtractionRequest(BaseModel):
    document: DocumentIn
    item: AssetIn


class AssetPatchRequest(BaseModel):
    title: str
    content: str
    era: str
    faction: str = "—"
    mood: str = "neutral"


# ── Custom persona endpoint ───────────────────────────────────────────────────

@app.post("/api/personas/custom")
async def generate_custom_persona(body: CustomPersonaRequest):
    """Generate a persona object from a free-text world description."""
    description = body.description.strip()
    if not description:
        raise HTTPException(400, "description is required")

    # A writer-specified timeline always wins over whatever the model would
    # invent -- clean it once here (strip, drop empties, case-insensitive
    # dedupe, cap at 10) and reuse the same cleaned list both in the prompt
    # and in the response, regardless of what the model echoes back.
    custom_eras: list[str] | None = None
    if body.customEras:
        cleaned: list[str] = []
        seen: set[str] = set()
        for e in body.customEras:
            if isinstance(e, str) and e.strip():
                v = e.strip()
                if v.lower() not in seen:
                    seen.add(v.lower())
                    cleaned.append(v)
        if len(cleaned) >= 2:
            custom_eras = cleaned[:10]

    system_prompt, user_prompt = gen.custom_persona_prompt(description, custom_eras)
    try:
        # Bumped from the 1000-token default: personaLabel + up to 6 eras + 4
        # nameIdeas + 2-3 full seed entries (each up to 140 words) can run
        # close to the old ceiling and get truncated into invalid JSON.
        text = await wx.generate(system_prompt, user_prompt, max_tokens=1400)
        raw = wx.parse_json(text)

        persona_label = raw.get("personaLabel")
        if not isinstance(persona_label, str) or not persona_label.strip():
            persona_label = "Custom world"

        if custom_eras:
            eras = custom_eras
        else:
            eras = raw.get("eras")
            if not (
                isinstance(eras, list)
                and 2 <= len(eras) <= 8
                and all(isinstance(e, str) and e.strip() for e in eras)
            ):
                eras = ["Act One", "Act Two", "Act Three"]

        name_ideas = raw.get("nameIdeas")
        name_ideas = [n for n in name_ideas if isinstance(n, str) and n.strip()] if isinstance(name_ideas, list) else []

        raw_seed = raw.get("seed") if isinstance(raw.get("seed"), list) else []
        # Normalize every seed entry the same way the main /generate endpoint
        # does, so a missing/invalid field from the model (most often a
        # dropped "content") can't cause create_world() to silently skip
        # that entry when the world is actually created.
        seed = [
            gen.normalize_seed_entry(s, eras)
            for s in raw_seed
            if isinstance(s, dict)
        ][:3]

        return {
            "personaLabel": persona_label,
            "eras": eras,
            "nameIdeas": name_ideas,
            "seed": seed,
        }
    except Exception as exc:
        raise HTTPException(502, f"Persona generation failed: {exc}")


# ── World endpoints ──────────────────────────────────────────────────────────

@app.post("/api/worlds", status_code=201)
def create_world(body: WorldCreate):
    existing = db.get_world(body.id)
    if existing:
        return existing

    world_data = body.model_dump(exclude={"seed"})
    # Same defensive cleaning as patch_world's eras handling below -- a
    # writer-typed custom timeline (comma-separated free text) can carry
    # stray whitespace or accidental duplicates; never let an empty result
    # through to the database.
    cleaned_eras: list[str] = []
    seen_eras: set[str] = set()
    for e in world_data.get("eras", []):
        if isinstance(e, str) and e.strip():
            v = e.strip()
            if v.lower() not in seen_eras:
                seen_eras.add(v.lower())
                cleaned_eras.append(v)
    world_data["eras"] = cleaned_eras or ["Act One", "Act Two", "Act Three"]

    world = db.create_world(world_data)

    for s in body.seed:
        try:
            db.create_asset(body.id, s)
        except Exception:
            pass  # seed already inserted on re-create

    return world


@app.get("/api/worlds/{world_id}")
def get_world(world_id: str):
    return _require_world(world_id)


@app.patch("/api/worlds/{world_id}")
def patch_world(world_id: str, body: WorldPatch):
    _require_world(world_id)
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if "eras" in data:
        # Defensive cleaning for every eras-touching path (reorder, add, a
        # different built-in persona) -- not just the dedicated rename/remove
        # endpoints below. Strip whitespace, drop empties, case-insensitive
        # dedupe, but never silently drop to zero eras.
        cleaned: list[str] = []
        seen: set[str] = set()
        for e in data["eras"]:
            if isinstance(e, str) and e.strip():
                v = e.strip()
                if v.lower() not in seen:
                    seen.add(v.lower())
                    cleaned.append(v)
        if not cleaned:
            raise HTTPException(400, "eras must contain at least one non-empty value")
        data["eras"] = cleaned
    updated = db.update_world(world_id, data)
    return _enrich_world(updated)


@app.post("/api/worlds/{world_id}/eras/rename")
def rename_era(world_id: str, body: EraRenameRequest):
    """Rename an era and cascade the change to every asset tagged with it, so
    renaming never silently orphans existing canon entries."""
    world = _require_world(world_id)
    old_era = body.oldEra.strip()
    new_era = body.newEra.strip()
    if not new_era:
        raise HTTPException(400, "newEra must not be empty")
    if old_era not in world["eras"]:
        raise HTTPException(404, f'Era "{old_era}" not found on this world')
    if new_era != old_era and any(e.lower() == new_era.lower() for e in world["eras"]):
        raise HTTPException(409, f'Era "{new_era}" already exists on this world')

    new_eras = [new_era if e == old_era else e for e in world["eras"]]
    notes = dict(world.get("eraNotes") or {})
    if old_era in notes:
        notes[new_era] = notes.pop(old_era)
    updated_world = db.update_world(world_id, {"eras": new_eras, "eraNotes": notes})
    affected = db.rename_asset_era(world_id, old_era, new_era)
    return {"world": _enrich_world(updated_world), "assetsUpdated": affected}


@app.post("/api/worlds/{world_id}/eras/remove")
def remove_era(world_id: str, body: EraRemoveRequest):
    """Remove an era. If any assets still use it, this requires mergeInto (one
    of the world's other eras) so removing an era can never silently strand
    or delete canon entries -- it either blocks with a clear count, or
    reassigns those entries to mergeInto before removing."""
    world = _require_world(world_id)
    era = body.era.strip()
    if era not in world["eras"]:
        raise HTTPException(404, f'Era "{era}" not found on this world')
    if len(world["eras"]) <= 1:
        raise HTTPException(400, "A world needs at least one era")

    assets_using = db.count_assets_by_era(world_id, era)
    reassigned = 0
    if assets_using:
        merge_into = (body.mergeInto or "").strip()
        if not merge_into or merge_into == era or merge_into not in world["eras"]:
            raise HTTPException(
                409,
                f'{assets_using} entr{"y" if assets_using == 1 else "ies"} still use "{era}". '
                f"Pass mergeInto with one of this world's other eras to move them there first.",
            )
        reassigned = db.rename_asset_era(world_id, era, merge_into)

    new_eras = [e for e in world["eras"] if e != era]
    notes = dict(world.get("eraNotes") or {})
    notes.pop(era, None)
    updated_world = db.update_world(world_id, {"eras": new_eras, "eraNotes": notes})
    return {"world": _enrich_world(updated_world), "assetsReassigned": reassigned}


@app.post("/api/worlds/{world_id}/eras/describe")
async def describe_eras(world_id: str, body: EraDescribeRequest):
    """AI-draft a 1-2 sentence description for each era that lacks one (or
    re-draft a single named era). Descriptions feed timeline_block(), the
    era-shift prompt, and portrait briefs -- they are how the model knows
    what an era actually means instead of guessing from its name."""
    world = _require_world(world_id)
    assets = db.list_assets(world_id)
    notes = dict(world.get("eraNotes") or {})

    if body.era is not None:
        target = body.era.strip()
        if target not in world["eras"]:
            raise HTTPException(404, f'Era "{target}" not found on this world')
        targets = [target]
    else:
        targets = [e for e in world["eras"] if not (notes.get(e) or "").strip()]

    if not targets:
        return {"world": world, "described": []}

    era_list = "\n".join(
        f"{i + 1}. {e}" + (f" — already described: {notes[e]}" if (notes.get(e) or "").strip() and e not in targets else "")
        for i, e in enumerate(world["eras"])
    )
    sample = "\n".join(
        f"- [{a['era']}] {a['title']}: {a['content'][:90]}" for a in assets[:8]
    )
    offline = False
    try:
        text = await wx.generate(
            f"{gen.persona_system(world)} You are annotating the world's timeline.",
            (
                "Here are this world's eras in chronological order:\n"
                f"{era_list}\n\n"
                "Sample canon entries for flavor:\n"
                f"{sample or '(none yet)'}\n\n"
                "Write a 1-2 sentence description for each of these eras: "
                + ", ".join(f'"{t}"' for t in targets)
                + ". Each description should say what defines the era — its "
                "events, tone, technology/culture, and how it relates to the "
                "eras around it. Stay consistent with the sample canon. "
                "Respond ONLY with a JSON object whose keys are exactly those "
                "era names and whose values are the description strings. "
                "Begin with { and end with }."
            ),
            max_tokens=600,
        )
        raw = wx.parse_json(text)
        by_lower = {t.lower(): t for t in targets}
        described = []
        for k, v in raw.items():
            key = by_lower.get(str(k).strip().lower())
            if key and isinstance(v, str) and v.strip():
                notes[key] = v.strip()[:300]
                described.append(key)
        if not described:
            raise RuntimeError("model returned no usable era descriptions")
    except Exception:
        # Offline fallback: at least encode each era's position in the
        # chronology, which is the single most important fact the model
        # was missing.
        offline = True
        described = list(targets)
        n = len(world["eras"])
        for t in targets:
            idx = world["eras"].index(t)
            notes[t] = f"Era {idx + 1} of {n} in this world's chronology."

    updated = db.update_world(world_id, {"eraNotes": notes})
    result = {"world": _enrich_world(updated), "described": described}
    if offline:
        result["offline"] = True
    return result


# ── Asset endpoints ──────────────────────────────────────────────────────────

@app.get("/api/worlds/{world_id}/assets")
def list_assets(world_id: str, type: str | None = None):
    _require_world(world_id)
    return db.list_assets(world_id, type_filter=type)


@app.post("/api/worlds/{world_id}/assets", status_code=201)
def save_asset(world_id: str, body: AssetIn):
    _require_world(world_id)
    return db.create_asset(world_id, body.model_dump())


@app.patch("/api/worlds/{world_id}/assets/{asset_id}")
def patch_asset(world_id: str, asset_id: int, body: AssetPatchRequest):
    _require_world(world_id)
    existing = db.get_asset(asset_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Asset not found in this world")
    if existing["worldId"] != world_id:
        raise HTTPException(status_code=404, detail="Asset not found in this world")
    return db.update_asset(asset_id, body.model_dump())


@app.delete("/api/worlds/{world_id}/assets/{asset_id}", status_code=200)
def delete_asset(world_id: str, asset_id: int):
    _require_world(world_id)
    asset = db.get_asset(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    if asset["worldId"] != world_id:
        raise HTTPException(status_code=404, detail="Asset not found in this world")
    db.delete_asset(asset_id)
    return {"deleted": True}


# ── Ingestion endpoints (Feature 1: script/doc → auto-breakdown) ─────────────

# Extraction is deliberately READ-ONLY: it returns proposed entries without
# writing anything. Nothing enters the World Book until the writer approves
# it via /ingest/commit below. This keeps the AI from silently editing the
# writer's canon, and means re-running an extraction has no side effects.

@app.post("/api/worlds/{world_id}/ingest")
async def ingest_document(world_id: str, body: IngestRequest):
    world = _require_world(world_id)

    text = body.text.strip()
    if not text:
        raise HTTPException(400, "text is required")

    offline = False
    try:
        raw_text = await wx.generate(
            ing.extraction_system_prompt(world),
            ing.extraction_user_prompt(text, world),
            max_tokens=1800,
        )
        raw = wx.parse_json(raw_text)
    except Exception:
        raw = ing.offline_extraction(text, world)
        offline = True

    extraction = ing.normalize_extraction(raw, world)

    # The document is described here but NOT inserted — it's created lazily on
    # first commit, so abandoned extractions don't leave orphan rows behind.
    document = {
        "id": f"doc-{int(time.time() * 1000)}-{random.randint(0, 999)}",
        "worldId": world_id,
        "title": (body.title or "Untitled document").strip() or "Untitled document",
        "rawText": text,
        "createdAt": int(time.time() * 1000),
    }

    proposed: list[dict] = []
    matches: list[dict] = []
    index = 0

    for category, asset_type in ing.EXTRACT_TYPES.items():
        for raw_item in extraction.get(category, []):
            item = ing.normalize_extracted_item(raw_item, world, asset_type, index)
            index += 1
            existing = db.find_asset_by_name(world_id, item["title"], asset_type)
            if existing:
                # Name collision with established canon — surface both versions
                # side by side and let the writer decide. Nothing is overwritten.
                matches.append({"existing": existing, "extracted": item})
            else:
                proposed.append(item)

    result = {
        "document": document,
        "proposed": proposed,
        "matches": matches,
        "timelineMarkers": extraction.get("timelineMarkers", []),
        "relationships": extraction.get("relationships", []),
    }
    if offline:
        result["offline"] = True
    return result


@app.post("/api/worlds/{world_id}/ingest/commit", status_code=201)
def commit_ingested(world_id: str, body: CommitRequest):
    """Persist writer-approved entries from a staged extraction.

    Accepts one or many assets so the UI can support both per-item approval
    and an 'approve all' action. The source document row is created here on
    first commit (idempotent — later commits from the same extraction reuse it).
    """
    _require_world(world_id)

    if not body.assets:
        raise HTTPException(400, "no assets to commit")

    doc = body.document
    if not db.get_document(doc.id):
        db.create_document({
            "id": doc.id,
            "world_id": world_id,
            "title": doc.title,
            "raw_text": doc.rawText,
            "created_at": doc.createdAt,
        })

    saved: list[dict] = []
    for asset in body.assets:
        data = asset.model_dump()
        # Approved by a human at this point, so it lands as confirmed canon.
        data["status"] = "confirmed"
        data["source_document_id"] = doc.id
        saved.append(db.create_asset(world_id, data))

    return {"created": saved}


@app.post("/api/worlds/{world_id}/ingest/update/{asset_id}")
def update_from_extraction(world_id: str, asset_id: int, body: UpdateFromExtractionRequest):
    """Overwrite an existing World Book asset with content from a matched extraction.

    Idempotent document creation mirrors commit_ingested: if the source document
    row doesn't exist yet, it's created here; subsequent calls reuse it.
    The asset is stamped status=confirmed and source_document_id so it's
    consistent with the commit path.
    """
    _require_world(world_id)

    existing = db.get_asset(asset_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Asset not found in this world")
    if existing["worldId"] != world_id:
        raise HTTPException(status_code=404, detail="Asset not found in this world")

    doc = body.document
    if not db.get_document(doc.id):
        db.create_document({
            "id": doc.id,
            "world_id": world_id,
            "title": doc.title,
            "raw_text": doc.rawText,
            "created_at": doc.createdAt,
        })

    data = body.item.model_dump()
    data["status"] = "confirmed"
    data["source_document_id"] = doc.id

    result = db.update_asset(asset_id, data)
    return {"updated": result}


# ── Export endpoint (Feature 2: assets → Markdown document) ─────────────────

# Unconditionally read-only: no db write function is called, and there is
# nothing to "commit" — the writer downloads the Markdown directly from the
# response payload.

@app.post("/api/worlds/{world_id}/export")
async def export_document(world_id: str, body: ExportRequest):
    world = _require_world(world_id)

    if body.docType not in exp.DOC_TYPES:
        raise HTTPException(400, f"docType must be one of: {', '.join(exp.DOC_TYPES)}")

    asset_type = exp.DOC_TYPES[body.docType]
    all_assets = db.list_assets(world_id, type_filter=asset_type)

    # Drop anything that hasn't been confirmed — defensive guard so a future
    # feature that persists unconfirmed rows can't silently leak drafts into
    # a production document.
    confirmed = [a for a in all_assets if a.get("status") != "unconfirmed"]

    # Apply optional era / faction filters (exact-match; values come from
    # data already in the DB, not free-form user text).
    # "beats" is always a full-world document — filtering to one era would
    # defeat its purpose, so these filters are intentionally skipped for it.
    if body.docType != "beats":
        if body.era:
            confirmed = [a for a in confirmed if a.get("era") == body.era]
        if body.faction:
            confirmed = [a for a in confirmed if a.get("faction") == body.faction]

    if not confirmed:
        return {
            "markdown": "",
            "docType": body.docType,
            "assetCount": 0,
            "empty": True,
        }

    offline = False
    try:
        markdown = await wx.generate(
            exp.compile_system_prompt(body.docType, world),
            exp.compile_user_prompt(body.docType, confirmed, world),
            max_tokens=1800,
        )
    except Exception:
        markdown = exp.offline_compile(body.docType, confirmed, world)
        offline = True

    result: dict = {
        "markdown": markdown,
        "docType": body.docType,
        "assetCount": len(confirmed),
        "generatedAt": int(time.time() * 1000),
    }
    if offline:
        result["offline"] = True
    return result


# ── NPC portrait (visual prompt drafting) ────────────────────────────────────

# The image itself is rendered client-side by Pollinations.ai from a
# deterministic URL (prompt + seed). This endpoint's job is only the
# "art director" step: have Granite compress the character sheet into a
# short visual description, and persist prompt + seed on the asset so the
# same face is reproducible forever. Calling it again re-drafts the prompt
# AND rolls a new seed -- i.e. it doubles as a "repaint" button.

@app.post("/api/worlds/{world_id}/assets/{asset_id}/portrait")
async def generate_portrait(world_id: str, asset_id: int):
    world = _require_world(world_id)
    asset = db.get_asset(asset_id)
    if not asset or asset.get("worldId") != world_id:
        raise HTTPException(404, "Asset not found")

    # Era context: without it the model guesses what an era name implies
    # (observed failure: same character rendered "older" in an era the model
    # assumed was later). The description drives costume/tech/atmosphere;
    # age comes from the canon entry, never from the era name.
    era_note = ((world.get("eraNotes") or {}).get(asset["era"]) or "").strip()
    era_line = f"Era: {asset['era']}" + (f" — {era_note}" if era_note else "")

    offline = False
    try:
        text = await wx.generate(
            "You are an art director translating story canon into a portrait "
            "brief for an illustrator. Output plain text only: a single 30-50 "
            "word visual description of the subject's appearance -- face, "
            "age, build, clothing, distinguishing marks, era-appropriate "
            "details, overall mood. Appearance only; no story, no names of "
            "other characters, no quotation marks. If an era description is "
            "provided, let it drive clothing, technology, and atmosphere -- "
            "but depict age exactly as the canon entry implies; never age the "
            "subject up or down because of which era it is.",
            (
                f"Subject: {asset['title']}\n"
                f"Type: {asset['type']}  {era_line}\n"
                f"Faction: {asset['faction']}  Mood: {asset['mood']}\n"
                f"Canon entry: {asset['content']}"
            ),
            max_tokens=120,
        )
        visual = " ".join(text.replace('"', "").split()).strip()
        if len(visual) < 15:
            raise RuntimeError("visual description came back empty/too short")
        visual = visual[:400]
    except Exception:
        # Offline fallback: a serviceable literal prompt straight from the
        # asset's own fields -- worse art direction, still a valid portrait.
        offline = True
        visual = (
            f"{asset['title']}, a {asset['mood']} {asset['type']} associated with "
            f"{asset['faction']} in the era of {asset['era']}. {asset['content'][:140]}"
        )

    seed = random.randint(1, 999_999)
    saved = db.update_asset(asset_id, {"portrait_prompt": visual, "portrait_seed": seed})
    result = {"asset": saved}
    if offline:
        result["offline"] = True
    return result


# ── Generation endpoint ───────────────────────────────────────────────────────

@app.post("/api/worlds/{world_id}/generate")
async def generate_asset(world_id: str, body: GenerateRequest):
    world = _require_world(world_id)
    assets = db.list_assets(world_id)

    mode = body.mode

    if mode == "era_shift":
        if not body.subject_id:
            raise HTTPException(400, "subject_id required for era_shift")
        subject = db.get_asset(body.subject_id)
        if not subject:
            raise HTTPException(404, "Subject asset not found")
        era = body.era or world["eras"][0]
        query = subject["title"]

        # Compute the shift direction server-side instead of hoping the model
        # infers it from era names. Observed failure without this: an adult
        # officer shifted 15 years BACKWARD came out the same age in the same
        # job -- the model never did the temporal arithmetic on its own.
        eras_list = world.get("eras", [])
        src_idx = eras_list.index(subject["era"]) if subject["era"] in eras_list else -1
        tgt_idx = eras_list.index(era) if era in eras_list else -1
        if src_idx != -1 and tgt_idx != -1 and src_idx != tgt_idx:
            direction = "EARLIER" if tgt_idx < src_idx else "LATER"
            time_line = (
                f"TIME DIRECTION: the target era \"{era}\" comes {direction} in this "
                f"world's chronology than the entry's current era \"{subject['era']}\" "
                f"(position {tgt_idx + 1} vs {src_idx + 1} of {len(eras_list)}).\n"
            )
        else:
            time_line = ""

        system_prompt = (
            f"{gen.persona_system(world)}\n\n"
            f"{gen.timeline_block(world)}\n\n"
            f"ESTABLISHED CANON (retrieved as most relevant to this request):\n"
            f"{ret.canon_block(assets, query)}\n\n"
            f"{gen.schema_for(world)} The \"era\" must be \"{era}\"."
        )
        user_prompt = (
            f"{time_line}"
            f"Re-render this canon entry as it exists in the era \"{era}\" "
            f"(the entry below is currently set in \"{subject['era']}\"). "
            "Respect the WORLD TIMELINE above, and apply elapsed time LITERALLY. "
            "If the era descriptions state or imply how many years separate the two "
            "eras, that gap governs everything — especially characters: in an EARLIER "
            "era a person is younger by exactly that gap (perhaps a child or teenager, "
            "an apprentice, or not yet holding their later role — in that case depict "
            "who and where they actually were then, not their later self transplanted); "
            "in a LATER era they are older by that gap — promoted, weathered, retired, "
            "or gone. Never carry a subject's age, rank, or posting across eras "
            "unchanged unless the timeline implies no meaningful time passes.\n"
            f"[{subject['type']}] {subject['title']}: {subject['content']}"
        )
        force_type = subject["type"]
    elif mode == "character":
        fragment = (body.fragment or "").strip()
        query = fragment if fragment else "new character faction location"

        # Creator-specified traits are HARD requirements, not suggestions --
        # anything the writer pinned down (gender, age, appearance,
        # personality) must appear in the generated content verbatim in
        # spirit; anything left blank stays AI-invented as before. Age and
        # appearance in the content also directly feed portrait briefs, so
        # pinning them here stabilizes the visual side too.
        traits = body.traits or {}
        trait_lines = []
        for key, label in (
            ("gender", "Gender"),
            ("age", "Age"),
            ("appearance", "Appearance"),
            ("personality", "Personality"),
        ):
            v = traits.get(key)
            if isinstance(v, str) and v.strip():
                trait_lines.append(f"{label}: {v.strip()[:200]}")
        traits_block = ""
        if trait_lines:
            traits_block = (
                " The creator has locked in these traits — every one of them is a hard "
                "requirement and must be explicitly reflected in the \"content\": "
                + "; ".join(trait_lines) + "."
            )

        system_prompt = (
            f"{gen.persona_system(world)}\n\n"
            f"ESTABLISHED CANON (retrieved as most relevant to this request):\n"
            f"{ret.canon_block(assets, query)}\n\n"
            f"{gen.schema_for(world)} The \"type\" must be \"character\"."
        )
        if fragment:
            user_prompt = (
                f"Create one new character based on this idea: {fragment}. "
                "They should belong organically in this world — tied to an existing place, "
                "faction, or event. Do not duplicate existing characters."
                + traits_block
            )
        else:
            user_prompt = (
                "Create one new character who belongs organically in this world — "
                "tied to an existing place, faction, or event. Do not duplicate existing characters."
                + traits_block
            )
        force_type = "character"
    else:  # expand
        fragment = body.fragment
        if not fragment:
            raise HTTPException(400, "fragment required for expand mode")
        query = fragment
        system_prompt = (
            f"{gen.persona_system(world)}\n\n"
            f"ESTABLISHED CANON (retrieved as most relevant to this request):\n"
            f"{ret.canon_block(assets, query)}\n\n"
            f"{gen.schema_for(world)}"
        )
        user_prompt = (
            f"Expand this idea into full original canon, weaving in established canon where natural: {fragment}"
        )
        force_type = None

    # Retrieve grounding context (what was sent to the model)
    grounding = ret.retrieve_relevant(assets, query, 10)

    try:
        text = await wx.generate(system_prompt, user_prompt)
        raw = wx.parse_json(text)
        asset = gen.normalize_asset(raw, world, force_type)

        # Tier 2: auto-tagging — run a lightweight second-pass classification
        asset = await _auto_tag(asset, world, assets)

        if mode == "era_shift":
            if body.era:
                asset["era"] = body.era
            asset["source_asset_id"] = subject["id"]
            existing = db.find_asset_by_source(world_id, subject["id"], asset["era"])
            if existing:
                saved = db.update_asset(existing["id"], asset)
            else:
                saved = db.create_asset(world_id, asset)
            return {"asset": saved, "grounding": grounding}

        if mode == "character":
            # Best-effort dedup: if the model produced a name that collides
            # with an existing character, retry once with explicit exclusions.
            existing_names = [
                a["title"] for a in assets
                if a.get("type") == "character"
                and a["title"].lower() == asset["title"].lower()
            ]
            if existing_names:
                try:
                    exclusion_list = ", ".join(f'"{n}"' for n in existing_names)
                    retry_user_prompt = (
                        "Create one new character who belongs organically in this world — "
                        "tied to an existing place, faction, or event. "
                        f"Do not use any of these existing names: {exclusion_list}."
                        + traits_block
                    )
                    retry_text = await wx.generate(system_prompt, retry_user_prompt)
                    retry_raw = wx.parse_json(retry_text)
                    retry_asset = gen.normalize_asset(retry_raw, world, force_type)
                    retry_asset = await _auto_tag(retry_asset, world, assets)
                    # Only accept the retry if it doesn't collide either
                    retry_collides = any(
                        a["title"].lower() == retry_asset["title"].lower()
                        for a in assets if a.get("type") == "character"
                    )
                    if not retry_collides:
                        asset = retry_asset
                except Exception:
                    pass  # best-effort — fall through and save the original

        saved = db.create_asset(world_id, asset)
        return {"asset": saved, "grounding": grounding}

    except Exception as exc:
        fallback = (
            gen.offline_asset(
                "a new figure connected to this world" if mode == "character" else (body.fragment or "new entry"),
                world, assets,
                force_type,
            )
        )
        if mode == "era_shift":
            fallback["source_asset_id"] = subject["id"]
            existing = db.find_asset_by_source(world_id, subject["id"], fallback["era"])
            if existing:
                fallback_saved = db.update_asset(existing["id"], fallback)
            else:
                fallback_saved = db.create_asset(world_id, fallback)
        else:
            fallback_saved = db.create_asset(world_id, fallback)
        return {
            "asset": fallback_saved,
            "grounding": grounding,
            "offline": True,
            "error": str(exc),
        }


# ── Tier 2: Auto-tagging ─────────────────────────────────────────────────────

async def _auto_tag(asset: dict, world: dict, assets: list[dict]) -> dict:
    """Run a second lightweight classification pass to assign/verify tags.

    Strategy: attempt a cheap model call with a short tagging prompt.
    If it fails for any reason (quota, timeout, etc.) fall back silently to
    the tags already embedded in the generation response — this is a best-
    effort enrichment step, not a hard requirement.
    """
    from generation import TYPES
    eras = world.get("eras", [])
    factions = list({a["faction"] for a in assets if a.get("faction") and a["faction"] != "—"})

    tag_prompt = (
        "You are a metadata classifier. Read the following canon entry and output ONLY valid JSON "
        "with these exact keys: \"type\" (must be one of: " + "|".join(TYPES) + "), "
        "\"era\" (must be one of: " + "|".join(eras) + "), "
        "\"faction\" (one of: " + (", ".join(factions[:12]) if factions else "—") + "; or \"—\"), "
        "\"mood\" (one lowercase word describing the emotional tone). "
        "Begin with { and end with }. No other text.\n\n"
        f"Entry title: {asset['title']}\nEntry content: {asset['content']}"
    )

    try:
        raw_tags = await wx.generate("", tag_prompt)
        tags = wx.parse_json(raw_tags)
        if tags.get("type") in TYPES:
            asset["type"] = tags["type"]
        if tags.get("era") in eras:
            asset["era"] = tags["era"]
        if isinstance(tags.get("faction"), str) and tags["faction"].strip():
            asset["faction"] = tags["faction"].strip()
        if isinstance(tags.get("mood"), str) and tags["mood"].strip():
            asset["mood"] = tags["mood"].strip().lower().split()[0]
    except Exception:
        pass  # best-effort — silently keep tags from generation pass

    return asset


# ── Consistency audit ────────────────────────────────────────────────────────

@app.post("/api/worlds/{world_id}/audit")
async def audit_world(world_id: str):
    world = _require_world(world_id)
    assets = db.list_assets(world_id)

    try:
        text = await wx.generate(
            f"{gen.persona_system(world)} You are running a canon consistency audit.",
            (
                "Audit this canon for internal contradictions. "
                "Respond ONLY with JSON: "
                "{\"issues\": [{\"severity\": \"high\"|\"low\", \"entries\": [\"title A\", \"title B\"], "
                "\"issue\": \"one plain-language sentence\"}]}. "
                "If nothing conflicts, return {\"issues\": []}.\n\n"
                f"CANON:\n{ret.canon_block(assets, '', 30)}"
            ),
        )
        parsed = wx.parse_json(text)
        issues = parsed.get("issues") if isinstance(parsed.get("issues"), list) else []
        return {"issues": issues}
    except Exception as exc:
        result = gen.offline_audit(assets)
        result["error"] = str(exc)
        return result


# ── Ask / Q&A ────────────────────────────────────────────────────────────────

# Conversational replies (lore Q&A, character chat) are meant to be a
# couple of sentences. Keep max_tokens tight so a runaway completion gets
# truncated instead of rambling into a second, hallucinated turn.
_ASK_MAX_TOKENS = 200


def _looks_like_leak(text: str, char_title: str | None = None) -> bool:
    """Best-effort guard against the model echoing instruction/meta text or
    hallucinating a new turn instead of replying in character. Not meant to
    catch everything — just the obvious cases — so a false negative here is
    fine (a slightly-off reply gets through) but a false positive routes a
    valid reply into the offline fallback, which is the safer failure mode.
    """
    if not text:
        return True
    stripped = text.strip()
    if len(stripped) > 700:
        return True
    lowered = stripped.lower()
    leak_markers = (
        "system prompt", "as an ai", "i am an ai", "language model",
        "give one sentence", "your response should", "you are a",
        "instructions:", "###", "<|", "role\":",
    )
    if any(marker in lowered for marker in leak_markers):
        return True
    # More than one non-empty line usually means the model kept generating
    # past its own reply (a new "Name:" turn, a stage direction block, etc.)
    # rather than stopping — in-character dialogue here should be prose,
    # not a multi-line script.
    lines = [l for l in stripped.split("\n") if l.strip()]
    if len(lines) > 2:
        return True
    return False


_EMOTIONS = ("neutral", "amused", "angry", "wary", "sad")


async def _classify_emotion(reply: str) -> str:
    """Best-effort second-pass emotion tag for a character reply -- drives
    the portrait's expression swap in the Characters screen. Same design
    contract as _auto_tag: a tiny extra model call that silently degrades
    to a safe default ("neutral") on any failure. Never raises."""
    try:
        raw = await wx.generate(
            "",
            "Classify the emotional tone of this line of dialogue as exactly "
            "one word from this list: neutral, amused, angry, wary, sad. "
            "Reply with that single word only.\n\n"
            f"Line: {reply}",
            max_tokens=6,
        )
        word = "".join(c for c in raw.strip().lower() if c.isalpha())
        if word in _EMOTIONS:
            return word
    except Exception:
        pass
    return "neutral"


@app.post("/api/worlds/{world_id}/ask")
async def ask(world_id: str, body: AskRequest):
    world = _require_world(world_id)
    assets = db.list_assets(world_id)

    try:
        if body.mode == "lore":
            system_prompt = (
                f"{gen.persona_system(world)} "
                "Answer questions using ONLY established canon. "
                "If canon doesn't cover something, say plainly it isn't decided yet and "
                "suggest it as a gap worth filling. Keep answers to 2-4 clear sentences."
            )
            user_prompt = f"CANON:\n{ret.canon_block(assets, body.question, 30)}\n\nQuestion: {body.question}"

            reply = await wx.generate(system_prompt, user_prompt, max_tokens=_ASK_MAX_TOKENS)
            if _looks_like_leak(reply):
                raise RuntimeError("generation looked malformed (leak guard)")
            return {"reply": reply.strip()}

        else:
            # Character in-character chat — pass prior turns as real
            # alternating user/assistant messages instead of collapsing
            # them into one string, so the model sees actual conversation
            # structure rather than a script it might keep writing past.
            char = db.get_asset(int(body.mode))
            if not char:
                raise HTTPException(404, "Character asset not found")

            system_prompt = (
                f"You are {char['title']} in the world \"{world['name']}\". "
                f"Character: {char['content']} ({char['era']}, {char['faction']}, {char['mood']}). "
                "Stay in character, consistent with canon. Reply in 1-3 sentences of dialogue only — "
                "no stage directions, no narration, no restating these instructions.\n\n"
                f"CANON:\n{ret.canon_block(assets, char['title'])}"
            )
            messages = [wx.chat_message("system", system_prompt)]
            for m in body.history:
                role = "user" if m["role"] == "user" else "assistant"
                messages.append(wx.chat_message(role, m["text"]))
            messages.append(wx.chat_message("user", body.question))

            reply = await wx.generate_messages(messages, max_tokens=_ASK_MAX_TOKENS)
            if _looks_like_leak(reply, char["title"]):
                raise RuntimeError("generation looked malformed (leak guard)")
            emotion = await _classify_emotion(reply)
            return {"reply": reply.strip(), "emotion": emotion}

    except HTTPException:
        raise
    except Exception as exc:
        if body.mode == "lore":
            return {"reply": gen.offline_answer(body.question, assets), "offline": True}
        return {"reply": f"They say nothing — the service is unreachable ({exc}).", "offline": True, "emotion": "neutral"}


# ── Diagnostics ───────────────────────────────────────────────────────────────

@app.get("/api/ping")
async def ping():
    try:
        result = await wx.ping()
        return {"ok": True, **result}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/api/models")
async def models():
    try:
        model_list = await wx.list_available_models()
        return {"models": model_list}
    except Exception as exc:
        raise HTTPException(500, str(exc))
