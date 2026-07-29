"""
Backlot: FastAPI backend

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
  POST /api/worlds/{id}/ingest/file                 Docling: PDF/DOCX upload -> extracted proposals (same shape as /ingest)
  POST /api/worlds/{id}/export         compile assets → Markdown/Fountain document (snapshots a version, Feature 2)
  POST /api/worlds/{id}/export/download  convert an already-compiled document to PDF/DOCX/Fountain/Markdown
  GET  /api/worlds/{id}/export/history                list past export versions for a docType, most-recent-first
  DELETE /api/worlds/{id}/export/history/{version_id}  remove one version from a docType's history
  POST /api/worlds/{id}/eras/rename    rename an era, cascading to every asset tagged with it
  POST /api/worlds/{id}/eras/remove    remove an era (optionally merging its assets into another)
  POST /api/worlds/{id}/eras/describe  AI-draft 1-2 sentence descriptions for eras that lack one
  POST /api/worlds/{id}/assets/{aid}/portrait   draft + store a visual portrait prompt/seed for an asset
  POST /api/worlds/{id}/assets/{aid}/voice/design    draft a voice description + one preview clip (character only)
  POST /api/worlds/{id}/assets/{aid}/voice/confirm   lock in a previewed voice as this character's permanent voice
  POST /api/worlds/{id}/assets/{aid}/voice/speak     synthesize reply text in the character's cast voice (MP3)
  POST /api/worlds/{id}/assets/{aid}/model3d/upload    upload concept media for an asset (3D .glb/.gltf, image, or video)
  POST /api/worlds/{id}/assets/{aid}/model3d/generate  kick off Blender/CharMorph 3D concept generation (character-only)
  GET  /api/worlds/{id}/assets/{aid}/model3d/status    poll 3D concept generation status
  DELETE /api/worlds/{id}/assets/{aid}/model3d         remove an asset's 3D concept model
  GET  /api/ping                       test watsonx connection
  GET  /api/models                     list available foundation models
"""

from __future__ import annotations

import json
import os
import random
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from dotenv import load_dotenv
load_dotenv()

import db
import watsonx as wx
import retrieval as ret
import generation as gen
import ingestion as ing
import export as exp
import model3d as m3d
import voice as vc

# ── App lifecycle ────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Backlot API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3D concept models (manual upload + Blender/CharMorph output) are served as
# static files, never stored as DB blobs -- multi-MB binaries are a bad fit
# for row storage. Directory is created here so a fresh checkout doesn't need
# a manual mkdir before the first upload/generation.
MODELS_DIR = Path(__file__).parent / "static" / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/models", StaticFiles(directory=str(MODELS_DIR)), name="models")


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
    description: str = ""          # short world premise, shown to every generation call
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
    description: str | None = None
    eras: list[str] | None = None
    eraNotes: dict | None = None
    ideas: list[dict] | None = None
    dialects: dict | None = None
    roles: list[str] | None = None


class AssetIn(BaseModel):
    id: int
    title: str
    type: str
    typeLabel: str = ""
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


class ExportDownloadRequest(BaseModel):
    docType: str
    format: str          # "pdf" | "docx" | "fountain" | "markdown"
    content: str          # the already-compiled text from /export (Markdown, or Fountain for "script")
    assetCount: int = 0


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
    typeLabel: str = ""


class VoiceDesignRequest(BaseModel):
    excludeVoiceIds: list[str] = []


class VoiceConfirmRequest(BaseModel):
    voiceId: str
    voiceDescription: str


class VoiceSpeakRequest(BaseModel):
    text: str


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
        # personaLabel + up to 6 eras + 4 nameIdeas + 2-3 full seed entries
        # (each up to 140 words) can run close to a tight ceiling and get
        # truncated into invalid JSON -- parse_json() has no partial-repair
        # path, so a truncated response loses the WHOLE persona (including
        # the eras/label that already generated fine), not just the seed.
        # This is the most likely cause of a "custom world came out empty"
        # report -- the frontend's offline fallback then silently produces
        # a world with generic eras and zero seed entries. Bumped
        # 1000 -> 1400 -> 2000 for headroom; if this still truncates with
        # the fallback model (mistral-medium-2505 tends to be more verbose
        # than granite), raise it further or trim seed to 2 entries.
        text = await wx.generate(system_prompt, user_prompt, max_tokens=2000)
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

        # Starter ideas for the Create screen -- same {label, text} shape as
        # the built-in PERSONAS.ideas in worldData.js. Silently drop any
        # malformed entry rather than failing the whole persona over it.
        raw_ideas = raw.get("ideas") if isinstance(raw.get("ideas"), list) else []
        ideas = [
            {"label": i["label"].strip(), "text": i["text"].strip()}
            for i in raw_ideas
            if isinstance(i, dict)
            and isinstance(i.get("label"), str) and i["label"].strip()
            and isinstance(i.get("text"), str) and i["text"].strip()
        ][:6]

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
            "ideas": ideas,
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

async def _stage_extraction(world_id: str, world: dict, text: str, title: str) -> dict:
    """Shared by /ingest (pasted text) and /ingest/file (Docling-converted
    text): runs extraction, normalizes it, and diffs against existing World
    Book assets. Read-only — nothing is written until /ingest/commit.
    """
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
        "title": (title or "Untitled document").strip() or "Untitled document",
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


@app.post("/api/worlds/{world_id}/ingest")
async def ingest_document(world_id: str, body: IngestRequest):
    world = _require_world(world_id)

    text = body.text.strip()
    if not text:
        raise HTTPException(400, "text is required")

    return await _stage_extraction(world_id, world, text, body.title)


@app.post("/api/worlds/{world_id}/ingest/file")
async def ingest_file(world_id: str, file: UploadFile = File(...), title: str = Form("")):
    """Companion to /ingest: same read-only staging as the paste path, but
    the source text comes from an uploaded file. PDF/DOCX go through IBM
    Docling to pull text out of the binary layout; TXT/Fountain are already
    plain text (Fountain is a plain-text screenplay markup format) so they're
    decoded directly with no Docling step. Either way, IBM Granite (inside
    _stage_extraction) extracts the structured canon from the resulting text.
    """
    world = _require_world(world_id)

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ing.SUPPORTED_UPLOAD_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type '{ext or 'unknown'}'. Upload a PDF, DOCX, TXT, or Fountain file.")

    data = await file.read()
    if not data:
        raise HTTPException(400, "Uploaded file is empty")

    try:
        if ext in ing.PLAIN_TEXT_UPLOAD_EXTENSIONS:
            text = ing.decode_plain_text_upload(data)
        else:
            text = ing.convert_upload_to_text(file.filename, data)
    except RuntimeError as e:
        raise HTTPException(422, str(e))

    text = text.strip()
    if not text:
        raise HTTPException(422, "Couldn't find any text in this file")

    return await _stage_extraction(world_id, world, text, title or file.filename)


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

    generated_at = int(time.time() * 1000)
    result: dict = {
        "markdown": markdown,
        "docType": body.docType,
        "assetCount": len(confirmed),
        "generatedAt": generated_at,
    }
    if offline:
        result["offline"] = True

    # Snapshot this compile into the docType's version history so writers can
    # page back through earlier drafts (a re-run with different filters, a
    # re-roll after editing canon, etc.) from the History panel instead of
    # losing the text the moment they regenerate or navigate away.
    version = db.create_export_version({
        "id": f"expv-{generated_at}-{random.randint(0, 999)}",
        "world_id": world_id,
        "doc_type": body.docType,
        "era": body.era,
        "faction": body.faction,
        "asset_count": len(confirmed),
        "content": markdown,
        "offline": offline,
        "created_at": generated_at,
    })
    result["versionId"] = version["id"]

    return result


# ── Export version history (Export screen: "Version History") ───────────────
#
# Read-only list/delete over the snapshots export_document() above writes.
# Nothing here re-runs the LLM or touches canon -- it's purely a window onto
# past compiles of a given document type.

@app.get("/api/worlds/{world_id}/export/history")
async def get_export_history(world_id: str, docType: str):
    _require_world(world_id)
    if docType not in exp.DOC_TYPES:
        raise HTTPException(400, f"docType must be one of: {', '.join(exp.DOC_TYPES)}")
    return db.list_export_versions(world_id, docType)


@app.delete("/api/worlds/{world_id}/export/history/{version_id}")
async def delete_export_history_version(world_id: str, version_id: str):
    _require_world(world_id)
    if not db.delete_export_version(version_id):
        raise HTTPException(404, "Version not found")
    return {"deleted": True}


# ── Export download endpoint (Feature 2 enhancement: real file formats) ─────

# Converts text the client already has (the "markdown" field from /export,
# above — Markdown for characters/locations/beats/pitch, Fountain for
# script) into an actual downloadable file. Deliberately separate from
# /export: this never re-runs the LLM, it just formats whatever was already
# compiled, so switching formats after a Generate is instant and free.

@app.post("/api/worlds/{world_id}/export/download")
async def export_download(world_id: str, body: ExportDownloadRequest):
    world = _require_world(world_id)

    if body.docType not in exp.DOC_TYPES:
        raise HTTPException(400, f"docType must be one of: {', '.join(exp.DOC_TYPES)}")

    try:
        data, media_type, filename = exp.render_download(
            body.docType, body.content, body.format,
            world_name=world["name"], asset_count=body.assetCount,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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


# ── AI-cast character voice (Gemini TTS) ─────────────────────────────────────

# Mirrors the portrait "art director" pattern above: Granite drafts a short
# voice description AND a gender read from the character's canon sheet, then
# that's matched against Gemini TTS's 30 fixed prebuilt voices (see
# voice.py's VOICE_POOL and module docstring for the full migration story
# and gender-mapping caveat -- migrated 2026-07-28 from ElevenLabs, whose
# free tier turned out to blanket-restrict any library/community voice via
# API regardless of selection mechanism). Gender is applied as a hard
# filter before the softer keyword scoring, same shape as before, so an
# explicit trait like "female" can't get outvoted by other matched words.
# IMPORTANT DIFFERENCE FROM THE OLD ELEVENLABS SHAPE: Gemini's fixed voices
# don't carry accent/tone themselves -- the character's voice_description
# has to be re-sent as prompt-time style direction on every synthesize()
# call, not just at casting time, so /voice/speak below passes
# asset["voiceDescription"] through, not just the voice id. Casting never
# touches the asset row until /voice/confirm -- clicking "regenerate" on
# the frontend just costs another design call (excluding voices already
# shown this session), the same way the portrait repaint button costs
# nothing but another seed. Once confirmed, the saved voice_id (a Gemini
# voice name, e.g. "Kore") and voice_description are both reused for every
# future chat reply via /voice/speak.

def _voice_description_prompt(asset: dict) -> str:
    return (
        f"Character: {asset['title']}\n"
        f"Type: {asset['type']}  Faction: {asset['faction']}  Mood: {asset['mood']}\n"
        f"Canon entry: {asset['content']}"
    )


@app.post("/api/worlds/{world_id}/assets/{asset_id}/voice/design")
async def design_character_voice(world_id: str, asset_id: int, body: VoiceDesignRequest = VoiceDesignRequest()):
    """Draft an accent + tone/pace description and gender read via Granite
    (accent is asked for separately from tone/pace and stated first in the
    final description, so it can't get diluted into a hedged blend when a
    character's origin differs from where they currently live -- see the
    prompt below), then pick a matching fixed Gemini TTS voice (gender
    hard-filtered first) and synthesize one preview line steered by that
    description. Nothing is persisted here -- call again (excluding voices
    already seen via body.excludeVoiceIds) for a fresh take, or POST
    .../voice/confirm once you like what you hear."""
    _require_world(world_id)
    asset = db.get_asset(asset_id)
    if not asset or asset.get("worldId") != world_id:
        raise HTTPException(404, "Asset not found")

    offline = False
    try:
        text = await wx.generate(
            "You are a voice director casting a narrator's read of a character "
            "for an audiobook. Read the canon entry and decide how this "
            "character would actually sound speaking aloud, then output a "
            "single JSON object and nothing else -- no explanation, no "
            "markdown. Keys: \"accent\" (2-6 words naming ONE primary accent, "
            "e.g. \"American, New York\" or \"Russian\" -- if the canon entry "
            "describes where this character is originally from/grew up versus "
            "where they currently live, their native/formative accent should "
            "DOMINATE: a lifelong accent doesn't vanish just because someone "
            "moved somewhere new. Only name a blended/softened/changed accent "
            "if the canon entry explicitly says their accent has changed over "
            "time -- otherwise pick the ONE accent their upbringing implies "
            "and state it plainly, don't hedge between two), \"description\" "
            "(a 15-40 word voice description covering apparent age, tone, and "
            "pace only -- do NOT restate the accent here, that's the "
            "\"accent\" key's job, and do not repeat the gender word itself, "
            "just how they sound), \"gender\" (exactly one of: male, female, "
            "neutral -- your best read of how this character's voice would be "
            "gendered; use neutral only if the canon entry gives genuinely no "
            "indication either way). Begin your response with { and end with }.",
            _voice_description_prompt(asset),
            max_tokens=140,
        )
        parsed = wx.parse_json(text)
        accent = " ".join(str(parsed.get("accent", "")).replace('"', "").split()).strip()[:60]
        tone_desc = " ".join(str(parsed.get("description", "")).replace('"', "").split()).strip()
        gender = str(parsed.get("gender", "")).strip().lower()
        if gender not in ("male", "female", "neutral"):
            gender = "neutral"
        if len(tone_desc) < 10:
            raise RuntimeError("voice description came back empty/too short")
        # Accent stated first and plainly (matches Gemini TTS's own
        # documented "Accent: ..." director's-note style) rather than folded
        # into a hedged, blended sentence -- a real bug this fixed: a
        # character described in canon as "American, moved to London" was
        # coming out sounding mostly British because the old single-field
        # prompt let the model hedge/blend the two instead of committing to
        # the character's actual formative accent.
        description = (f"Accent: {accent}. {tone_desc}" if accent else tone_desc)[:400]
    except Exception:
        # Offline fallback: a serviceable literal description straight from
        # the asset's own fields -- less characterful, still a valid cast.
        # Gender can't be inferred without a model call, so guess from
        # pronoun counts in the canon text itself; ties or no pronouns at
        # all fall back to "neutral" (no hard filter applied).
        offline = True
        description = (
            f"A {asset['mood']} voice fitting a {asset['type']} associated with "
            f"{asset['faction']}, speaking in a natural, consistent register."
        )
        canon_lower = (asset.get("content") or "").lower()
        she_count = len(re.findall(r"\bshe\b|\bher\b|\bhers\b", canon_lower))
        he_count = len(re.findall(r"\bhe\b|\bhim\b|\bhis\b", canon_lower))
        if she_count > he_count:
            gender = "female"
        elif he_count > she_count:
            gender = "male"
        else:
            gender = "neutral"

    try:
        preview = await vc.cast_voice_preview(
            description,
            body.excludeVoiceIds,
            f"Hello, I'm {asset['title']}.",
            gender if gender != "neutral" else None,
        )
    except Exception as exc:
        # Printed (not just returned in the 503 body) so it shows up in the
        # uvicorn terminal directly -- avoids needing to dig into browser
        # DevTools' Network tab to see the real Gemini TTS error.
        print(f"[voice/design] failed: {exc}")
        raise HTTPException(503, f"Voice preview unavailable right now: {exc}")

    result = {
        "voiceDescription": description,
        "voiceId": preview["voiceId"],
        "voiceName": preview["voiceName"],
        "audioBase64": preview["audioBase64"],
    }
    if offline:
        result["offline"] = True
    return result


@app.post("/api/worlds/{world_id}/assets/{asset_id}/voice/confirm")
async def confirm_character_voice(world_id: str, asset_id: int, body: VoiceConfirmRequest):
    """Lock in a previewed fixed voice + its style description as this
    character's permanent voice -- every future chat reply for them reuses
    both this voice_id (a Gemini voice name) and voiceDescription from here
    on. No external call needed at confirm time: nothing is created,
    Gemini's voices are fixed and always available."""
    _require_world(world_id)
    asset = db.get_asset(asset_id)
    if not asset or asset.get("worldId") != world_id:
        raise HTTPException(404, "Asset not found")

    saved = db.update_asset(
        asset_id, {"voice_id": body.voiceId, "voice_description": body.voiceDescription}
    )
    return {"asset": saved}


@app.post("/api/worlds/{world_id}/assets/{asset_id}/voice/speak")
async def speak_as_character(world_id: str, asset_id: int, body: VoiceSpeakRequest):
    """Synthesize `text` in this character's already-cast voice. Returns a
    playable WAV file on success. Any failure here -- no voice cast yet,
    Gemini quota exhausted, network error -- raises so the frontend's fetch
    sees a non-OK response and falls back to Web Speech instead of the
    reply just going silent."""
    _require_world(world_id)
    asset = db.get_asset(asset_id)
    if not asset or asset.get("worldId") != world_id:
        raise HTTPException(404, "Asset not found")
    voice_id = asset.get("voiceId")
    if not voice_id:
        raise HTTPException(409, "No voice has been cast for this character yet")
    # Gemini's fixed voices need the style description re-sent on every
    # call (see voice.py's module docstring) -- unlike the old ElevenLabs
    # shape, the voice_id alone isn't enough to sound like this character.
    voice_description = asset.get("voiceDescription") or ""

    try:
        audio = await vc.synthesize(voice_id, voice_description, body.text)
    except Exception as exc:
        print(f"[voice/speak] failed: {exc}")
        raise HTTPException(503, f"Voice playback unavailable right now: {exc}")

    return Response(content=audio, media_type="audio/wav")


# ── 3D concept model (manual upload + Blender/CharMorph generation) ─────────

# Storage: unlike the portrait system above (zero storage -- Pollinations
# URLs are reconstructed deterministically), a 3D model is a real binary file
# that must be persisted. It lives on disk under MODELS_DIR and is served via
# the /models static mount registered above; the DB only stores the served
# path + status/provenance, never the file bytes.

MODEL3D_EXTS = {".glb", ".gltf"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
VIDEO_EXTS = {".mp4", ".webm", ".mov"}
CONCEPT_MEDIA_EXTS = MODEL3D_EXTS | IMAGE_EXTS | VIDEO_EXTS


def _concept_media_kind(ext: str) -> str | None:
    """Classify an uploaded file's extension into the Gallery's three
    concept-media kinds, or None if it isn't one we accept."""
    if ext in MODEL3D_EXTS:
        return "3d"
    if ext in IMAGE_EXTS:
        return "image"
    if ext in VIDEO_EXTS:
        return "video"
    return None


@app.post("/api/worlds/{world_id}/assets/{asset_id}/model3d/upload")
async def upload_model3d(world_id: str, asset_id: int, file: UploadFile = File(...)):
    """Manual import path: upload a pre-made 3D model (.glb/.gltf), a
    concept-art image, or a short video as an asset's concept media. Works
    for any asset type (not just characters) -- images and video are the
    only option for lore/location/event/other entries, which have no 3D
    generation path, and both remain available for characters too alongside
    Blender/CharMorph generation."""
    _require_world(world_id)
    asset = db.get_asset(asset_id)
    if not asset or asset.get("worldId") != world_id:
        raise HTTPException(404, "Asset not found in this world")

    ext = os.path.splitext(file.filename or "")[1].lower()
    kind = _concept_media_kind(ext)
    if kind is None:
        supported = ", ".join(sorted(CONCEPT_MEDIA_EXTS))
        raise HTTPException(400, f"Unsupported file type '{ext or 'unknown'}'. Supported: {supported}")

    data = await file.read()
    if not data:
        raise HTTPException(400, "Uploaded file is empty")

    # Clear out any previously stored file for this asset, regardless of its
    # extension (e.g. swapping an uploaded .glb for a .mp4) -- otherwise the
    # old file lingers orphaned on disk once the DB row points at the new one.
    for existing in MODELS_DIR.glob(f"{asset_id}.*"):
        existing.unlink()

    dest = MODELS_DIR / f"{asset_id}{ext}"
    dest.write_bytes(data)

    saved = db.update_asset(asset_id, {
        "model_path": f"/models/{asset_id}{ext}",
        "model_source": "manual",
        "model_status": "ready",
        "model_error": None,
        "model_added_at": int(time.time() * 1000),
        "model_kind": kind,
    })
    return {"asset": saved}


@app.post("/api/worlds/{world_id}/assets/{asset_id}/model3d/generate")
async def generate_model3d(world_id: str, asset_id: int, background_tasks: BackgroundTasks):
    """Kick off the Granite -> Blender -> CharMorph pipeline for a character.
    Generation takes real time (not instant like the portrait endpoint), so
    this returns immediately with model_status="pending" and does the actual
    work in a background task; the frontend polls the status endpoint below."""
    _require_world(world_id)
    asset = db.get_asset(asset_id)
    if not asset or asset.get("worldId") != world_id:
        raise HTTPException(404, "Asset not found in this world")
    if asset.get("type") != "character":
        raise HTTPException(400, "3D concept generation is only available for character assets")

    saved = db.update_asset(asset_id, {"model_status": "pending", "model_error": None})
    background_tasks.add_task(m3d.generate_and_store, asset_id, asset)
    return {"asset": saved}


@app.get("/api/worlds/{world_id}/assets/{asset_id}/model3d/status")
def model3d_status(world_id: str, asset_id: int):
    _require_world(world_id)
    asset = db.get_asset(asset_id)
    if not asset or asset.get("worldId") != world_id:
        raise HTTPException(404, "Asset not found in this world")
    return {"asset": asset}


@app.delete("/api/worlds/{world_id}/assets/{asset_id}/model3d")
def delete_model3d(world_id: str, asset_id: int):
    """Remove an asset's concept media (3D model, image, or video) --
    deletes the file on disk (if present) and clears the model_* fields on
    the asset row. Exists so "delete" is something the app tracks, instead
    of deleting the file by hand on disk (which the DB never finds out
    about, so the Gallery keeps showing it as if it still exists). Globs by
    asset id rather than assuming a .glb extension, since the stored file
    can now be any of the accepted concept-media formats."""
    _require_world(world_id)
    asset = db.get_asset(asset_id)
    if not asset or asset.get("worldId") != world_id:
        raise HTTPException(404, "Asset not found in this world")

    for existing in MODELS_DIR.glob(f"{asset_id}.*"):
        existing.unlink()

    saved = db.update_asset(asset_id, {
        "model_path": None,
        "model_source": None,
        "model_status": None,
        "model_error": None,
        "model_added_at": None,
        "model_kind": None,
    })
    return {"asset": saved}


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
            f"{gen.schema_for(world, title_style=('character' if subject['type'] == 'character' else None))} "
            f"The \"era\" must be \"{era}\" and the \"type\" must be \"{subject['type']}\"."
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
            "unchanged unless the timeline implies no meaningful time passes. "
            "This is the exact same entry re-imagined for a different era, not a new "
            "one -- its name/title and type must stay exactly as given below; only "
            "its situation, appearance, role, and content change.\n"
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
            f"{gen.schema_for(world, title_style='character')} The \"type\" must be \"character\"."
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
        # A malformed/truncated model response can come back with an empty or
        # missing title/content -- normalize_asset() would silently paper over
        # that with "Untitled entry" / "No description was returned." and this
        # would still be treated as success. Fail loudly instead so it falls
        # through to the offline-fallback path below, which surfaces the real
        # error to the user instead of saving a fake entry.
        if not (isinstance(raw.get("title"), str) and raw.get("title").strip()) or \
           not (isinstance(raw.get("content"), str) and raw.get("content").strip()):
            raise RuntimeError("model returned an incomplete entry (missing title/content)")
        asset = gen.normalize_asset(raw, world, force_type)

        # Tier 2: auto-tagging — run a lightweight second-pass classification.
        # era_shift locks the type so this pass can't quietly reclassify an
        # entry that's being re-rendered, not reinvented.
        asset = await _auto_tag(asset, world, assets, lock_type=(mode == "era_shift"))

        if mode == "era_shift":
            if body.era:
                asset["era"] = body.era
            # Identity lock: era-shifting must never change WHAT the entry is
            # or WHO a character is -- only how they appear/are situated in
            # this era. Discard whatever type/title the model (or the
            # auto-tagger above) returned; small models don't reliably follow
            # this instruction from the prompt alone (same reasoning as the
            # server-computed TIME DIRECTION above), so it's enforced here
            # unconditionally instead of just requested.
            asset["type"] = subject["type"]
            if subject["type"] == "character":
                asset["title"] = subject["title"]
            if subject["type"] == "other":
                asset["typeLabel"] = subject.get("typeLabel", "")
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
                subject.get("typeLabel", "") if mode == "era_shift" and subject.get("type") == "other" else None,
            )
        )
        if mode == "era_shift":
            # Same identity lock as the online path above -- an offline draft
            # must not split a character into two differently-named entries
            # either.
            fallback["type"] = subject["type"]
            if subject["type"] == "character":
                fallback["title"] = subject["title"]
            if subject["type"] == "other":
                fallback["typeLabel"] = subject.get("typeLabel", "")
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

async def _auto_tag(asset: dict, world: dict, assets: list[dict], lock_type: bool = False) -> dict:
    """Run a second lightweight classification pass to assign/verify tags.

    Strategy: attempt a cheap model call with a short tagging prompt.
    If it fails for any reason (quota, timeout, etc.) fall back silently to
    the tags already embedded in the generation response — this is a best-
    effort enrichment step, not a hard requirement.

    lock_type=True means the caller already knows the correct type from
    context (era-shift, where type must match the source entry) -- this
    pass then may not reclassify it.
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
        if not lock_type and tags.get("type") in TYPES:
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

# Consistency check: how many of a world's most-recently-created assets
# get sent to the model. Every included asset's FULL content is sent,
# untruncated -- unlike normal generation grounding (which retrieves only
# a few entries relevant to one query and truncates each), this needs the
# whole canon at once to actually find cross-entry contradictions. The
# cap exists only to keep the prompt inside a safe token budget for very
# large worlds; when it bites, the response says so (`skipped`) instead
# of silently acting like coverage was complete.
_AUDIT_ASSET_LIMIT = 60


@app.post("/api/worlds/{world_id}/audit")
async def audit_world(world_id: str):
    world = _require_world(world_id)
    assets = db.list_assets(world_id)

    audited = assets[-_AUDIT_ASSET_LIMIT:] if len(assets) > _AUDIT_ASSET_LIMIT else assets
    skipped = max(0, len(assets) - len(audited))

    try:
        system = f"{gen.persona_system(world)} You are running a canon consistency audit."
        canon = ret.full_canon_block(audited)

        text = await wx.generate(
            system,
            (
                "Read this world's ENTIRE canon below, in full. Find genuine internal "
                "contradictions (facts that can't both be true) and cross-type name "
                "collisions (two different entries -- of different types -- sharing the "
                "same or a near-identical name, which makes them hard to tell apart "
                "elsewhere in the app). Only flag something you can point to specific "
                "text for -- do not invent or guess at issues the text doesn't actually "
                "support.\n"
                "Respond ONLY with JSON: {\"issues\": [{\"severity\": \"high\"|\"low\", "
                "\"entries\": [\"title A\", \"title B\"], \"issue\": \"one plain-language "
                "sentence\", \"evidence\": \"a short quote or close paraphrase from each "
                "entry that supports this\"}]}. "
                "If nothing conflicts, return {\"issues\": []}.\n\n"
                f"CANON:\n{canon}"
            ),
            max_tokens=1200,
        )
        parsed = wx.parse_json(text)
        candidates = parsed.get("issues") if isinstance(parsed.get("issues"), list) else []

        # Verification pass: this app has repeatedly found that a single
        # unverified call from these models isn't trustworthy for
        # open-ended judgment calls (see era-shift temporal reasoning and
        # character-identity fixes elsewhere in this file) -- so before
        # anything is shown to the user, ask the model to re-check its own
        # candidate issues against the full canon and drop whatever isn't
        # actually supported. If this second call fails, fall back to the
        # unverified candidates rather than losing the audit entirely.
        issues = candidates
        if candidates:
            try:
                verify_text = await wx.generate(
                    system,
                    (
                        "You proposed these possible canon issues for this world. "
                        "Re-check EACH one carefully against the full canon below -- you "
                        "sometimes flag things the text doesn't actually support, so be "
                        "skeptical of your own prior answer. Drop any issue that isn't "
                        "clearly and specifically backed by the text, and make sure "
                        "\"evidence\" genuinely quotes or closely paraphrases the actual "
                        "entries.\n"
                        f"YOUR PROPOSED ISSUES:\n{json.dumps(candidates)}\n\n"
                        f"CANON:\n{canon}\n\n"
                        "Respond ONLY with the same JSON shape, containing only the "
                        "confirmed issues: {\"issues\": [...]}."
                    ),
                    max_tokens=1200,
                )
                verify_parsed = wx.parse_json(verify_text)
                verified = verify_parsed.get("issues")
                if isinstance(verified, list):
                    issues = verified
            except Exception:
                pass

        result: dict = {"issues": issues}
        if skipped:
            result["skipped"] = skipped
        return result
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

            premise = gen.premise_block(world)
            system_prompt = (
                f"You are {char['title']} in the world \"{world['name']}\". "
                f"Character: {char['content']} ({char['era']}, {char['faction']}, {char['mood']}). "
                + (f"{premise} " if premise else "")
                + "You know about your world in general, not just your own entry -- if asked "
                "about the world itself, answer in character using what a person like you would "
                "plausibly know. "
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
        return {"reply": f"They say nothing. The service is unreachable ({exc}).", "offline": True, "emotion": "neutral"}


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
