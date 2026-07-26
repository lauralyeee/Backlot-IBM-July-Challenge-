"""
AI Worldbuilding Co-Pilot — FastAPI backend

Endpoints:
  POST /api/worlds                     create world (+ bulk-seed assets)
  GET  /api/worlds/{id}                get world
  PATCH /api/worlds/{id}               update world metadata
  GET  /api/worlds/{id}/assets         list assets (optional ?type=)
  POST /api/worlds/{id}/assets         save a pre-built asset (used at onboarding seed)
  POST /api/worlds/{id}/generate       gap-fill / character / era-shift generation
  POST /api/worlds/{id}/audit          consistency audit
  POST /api/worlds/{id}/ask            Q&A (lore or character-in-character)
  GET  /api/ping                       test watsonx connection
  GET  /api/models                     list available foundation models
"""

from __future__ import annotations

import os
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
        query = "new character faction location"
        system_prompt = (
            f"{gen.persona_system(world)}\n\n"
            f"ESTABLISHED CANON (retrieved as most relevant to this request):\n"
            f"{ret.canon_block(assets, query)}\n\n"
            f"{gen.schema_for(world)} The \"type\" must be \"character\"."
        )
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

        if mode == "era_shift" and body.era:
            asset["era"] = body.era

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
        else:
            # Character in-character chat
            char = db.get_asset(int(body.mode))
            if not char:
                raise HTTPException(404, "Character asset not found")
            history_lines = "\n".join(
                f"{'Visitor' if m['role'] == 'user' else char['title']}: {m['text']}"
                for m in body.history
            )
            system_prompt = (
                f"You are {char['title']} in the world \"{world['name']}\". "
                f"Character: {char['content']} ({char['era']}, {char['faction']}, {char['mood']}). "
                "Stay in character, consistent with canon. Reply in 1-3 sentences of dialogue only.\n\n"
                f"CANON:\n{ret.canon_block(assets, char['title'])}"
            )
            user_prompt = (
                f"Conversation:\n{history_lines}\n\nReply as {char['title']}."
            )

        reply = await wx.generate(system_prompt, user_prompt)
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
