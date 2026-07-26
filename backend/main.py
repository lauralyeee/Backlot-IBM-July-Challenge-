"""
AI Worldbuilding Co-Pilot — FastAPI backend

Endpoints:
  POST /api/worlds                     create world (+ bulk-seed assets)
  GET  /api/worlds/{id}                get world
  PATCH /api/worlds/{id}               update world metadata
  GET  /api/worlds/{id}/assets         list assets (optional ?type=)
  POST /api/worlds/{id}/assets         save a pre-built asset (used at onboarding seed)
  DELETE /api/worlds/{id}/assets/{aid} delete an asset
  POST /api/worlds/{id}/generate       gap-fill / character / era-shift generation
  POST /api/worlds/{id}/audit          consistency audit
  POST /api/worlds/{id}/ask            Q&A (lore or character-in-character)
  POST /api/personas/custom            generate a persona from a free-text description
  POST /api/worlds/{id}/ingest         script/doc ingestion → auto-breakdown (Feature 1)
  POST /api/worlds/{id}/assets/{aid}/confirm   approve an unconfirmed ingested asset
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


class AskRequest(BaseModel):
    mode: str                    # "lore" | character asset id as string
    question: str
    history: list[dict] = []     # [{role, text}, …] for character chat


class AuditRequest(BaseModel):
    pass  # no body needed — uses all assets for the world


class CustomPersonaRequest(BaseModel):
    description: str


class IngestRequest(BaseModel):
    text: str
    title: str = "Untitled document"


# ── Custom persona endpoint ───────────────────────────────────────────────────

@app.post("/api/personas/custom")
async def generate_custom_persona(body: CustomPersonaRequest):
    """Generate a persona object from a free-text world description."""
    description = body.description.strip()
    if not description:
        raise HTTPException(400, "description is required")

    system_prompt, user_prompt = gen.custom_persona_prompt(description)
    try:
        # Bumped from the 1000-token default: personaLabel + 3 eras + 4
        # nameIdeas + 2-3 full seed entries (each up to 140 words) can run
        # close to the old ceiling and get truncated into invalid JSON.
        text = await wx.generate(system_prompt, user_prompt, max_tokens=1400)
        raw = wx.parse_json(text)

        persona_label = raw.get("personaLabel")
        if not isinstance(persona_label, str) or not persona_label.strip():
            persona_label = "Custom world"

        eras = raw.get("eras")
        if not (isinstance(eras, list) and len(eras) == 3 and all(isinstance(e, str) and e.strip() for e in eras)):
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
    updated = db.update_world(world_id, data)
    return _enrich_world(updated)


# ── Asset endpoints ──────────────────────────────────────────────────────────

@app.get("/api/worlds/{world_id}/assets")
def list_assets(world_id: str, type: str | None = None):
    _require_world(world_id)
    return db.list_assets(world_id, type_filter=type)


@app.post("/api/worlds/{world_id}/assets", status_code=201)
def save_asset(world_id: str, body: AssetIn):
    _require_world(world_id)
    return db.create_asset(world_id, body.model_dump())


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


# ── Ingestion endpoint (Feature 1: script/doc → auto-breakdown) ─────────────

@app.post("/api/worlds/{world_id}/ingest", status_code=201)
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

    document = db.create_document({
        "id": f"doc-{int(time.time() * 1000)}-{random.randint(0, 999)}",
        "world_id": world_id,
        "title": (body.title or "Untitled document").strip() or "Untitled document",
        "raw_text": text,
        "created_at": int(time.time() * 1000),
    })

    created: list[dict] = []
    matches: list[dict] = []

    for category, asset_type in ing.EXTRACT_TYPES.items():
        for raw_item in extraction.get(category, []):
            item = ing.normalize_extracted_item(raw_item, world, asset_type)
            existing = db.find_asset_by_name(world_id, item["title"], asset_type)
            if existing:
                # Match found — never silently overwrite established canon.
                # Attach the source document for traceability and surface
                # both versions so the writer can decide whether to update
                # the existing entry by hand.
                linked = db.update_asset(existing["id"], {"source_document_id": document["id"]})
                matches.append({"existing": linked, "extracted": item})
            else:
                item["status"] = "unconfirmed"
                item["source_document_id"] = document["id"]
                saved = db.create_asset(world_id, item)
                created.append(saved)

    result = {
        "document": document,
        "created": created,
        "matches": matches,
        "timelineMarkers": extraction.get("timelineMarkers", []),
        "relationships": extraction.get("relationships", []),
    }
    if offline:
        result["offline"] = True
    return result


@app.post("/api/worlds/{world_id}/assets/{asset_id}/confirm")
def confirm_asset(world_id: str, asset_id: int):
    _require_world(world_id)
    asset = db.get_asset(asset_id)
    if not asset or asset["worldId"] != world_id:
        raise HTTPException(status_code=404, detail="Asset not found in this world")
    return db.update_asset(asset_id, {"status": "confirmed"})


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
        system_prompt = (
            f"{gen.persona_system(world)}\n\n"
            f"ESTABLISHED CANON (retrieved as most relevant to this request):\n"
            f"{ret.canon_block(assets, query)}\n\n"
            f"{gen.schema_for(world)} The \"era\" must be \"{era}\"."
        )
        user_prompt = (
            f"Re-render this canon entry as it exists in the era \"{era}\", "
            f"without breaking continuity:\n[{subject['type']}] {subject['title']}: {subject['content']}"
        )
        force_type = subject["type"]
    elif mode == "character":
        fragment = (body.fragment or "").strip()
        query = fragment if fragment else "new character faction location"
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
            )
        else:
            user_prompt = (
                "Create one new character who belongs organically in this world — "
                "tied to an existing place, faction, or event. Do not duplicate existing characters."
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
            return {"reply": reply.strip()}

    except HTTPException:
        raise
    except Exception as exc:
        if body.mode == "lore":
            return {"reply": gen.offline_answer(body.question, assets), "offline": True}
        return {"reply": f"They say nothing — the service is unreachable ({exc}).", "offline": True}


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
