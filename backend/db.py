"""
SQLite database layer for Backlot.
Tables: worlds, assets.
"""

import sqlite3
import os
import difflib
from pathlib import Path

DB_PATH = os.environ.get("DB_PATH", str(Path(__file__).parent / "worldbuilding.db"))


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS worlds (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                persona_id  TEXT NOT NULL,
                persona_label TEXT NOT NULL,
                eras        TEXT NOT NULL,   -- JSON array
                ideas       TEXT NOT NULL,   -- JSON array
                dialects    TEXT NOT NULL,   -- JSON object
                roles       TEXT NOT NULL,   -- JSON array
                created_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS assets (
                id          INTEGER PRIMARY KEY,
                world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                type        TEXT NOT NULL,
                era         TEXT NOT NULL,
                faction     TEXT NOT NULL DEFAULT '—',
                mood        TEXT NOT NULL DEFAULT 'neutral',
                content     TEXT NOT NULL,
                offline     INTEGER NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_assets_world ON assets(world_id);
            CREATE INDEX IF NOT EXISTS idx_assets_type  ON assets(world_id, type);

            CREATE TABLE IF NOT EXISTS documents (
                id          TEXT PRIMARY KEY,
                world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                raw_text    TEXT NOT NULL,
                created_at  INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_documents_world ON documents(world_id);

            CREATE TABLE IF NOT EXISTS relationships (
                id                  TEXT PRIMARY KEY,
                world_id            TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
                asset_a_title       TEXT NOT NULL,
                asset_b_title       TEXT NOT NULL,
                context             TEXT NOT NULL,
                source_document_id  TEXT,
                created_at          INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_relationships_world ON relationships(world_id);

            CREATE TABLE IF NOT EXISTS export_versions (
                id          TEXT PRIMARY KEY,
                world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
                doc_type    TEXT NOT NULL,
                era         TEXT NOT NULL DEFAULT '',
                faction     TEXT NOT NULL DEFAULT '',
                asset_count INTEGER NOT NULL DEFAULT 0,
                content     TEXT NOT NULL,
                offline     INTEGER NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_export_versions_world_doctype ON export_versions(world_id, doc_type);
        """)
        # Additive migrations below -- ALTER TABLE is a no-op if the column already exists.
        existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(assets)").fetchall()}
        if "source_asset_id" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN source_asset_id INTEGER DEFAULT NULL")
        # status + source_document_id: script-ingestion review flow; source_document_id
        # is reused by The Loop's re-import/re-export sync later.
        if "status" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'")
        if "source_document_id" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN source_document_id TEXT DEFAULT NULL")
        # portrait_prompt/portrait_seed: the image itself isn't stored -- Pollinations
        # URLs are deterministic (same prompt+seed = same face), so these rebuild it.
        if "portrait_prompt" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN portrait_prompt TEXT DEFAULT NULL")
        if "portrait_seed" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN portrait_seed INTEGER DEFAULT NULL")
        # era_notes: 1-2 sentence description per era, so era-shift generation has
        # real context instead of guessing chronology from era names alone.
        world_cols = {row[1] for row in conn.execute("PRAGMA table_info(worlds)").fetchall()}
        if "era_notes" not in world_cols:
            conn.execute("ALTER TABLE worlds ADD COLUMN era_notes TEXT NOT NULL DEFAULT '{}'")
        # description: short world premise, fed into every generation prompt
        # via generation.premise_block().
        if "description" not in world_cols:
            conn.execute("ALTER TABLE worlds ADD COLUMN description TEXT NOT NULL DEFAULT ''")
        # 3D concept model fields. model_status tracks async generation state
        # (pending/ready/failed) since Blender runs as a subprocess, not inline.
        if "model_path" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN model_path TEXT DEFAULT NULL")
        if "model_source" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN model_source TEXT DEFAULT NULL")
        if "model_status" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN model_status TEXT DEFAULT NULL")
        if "model_error" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN model_error TEXT DEFAULT NULL")
        if "model_added_at" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN model_added_at INTEGER DEFAULT NULL")
        # model_kind: Gallery also accepts uploaded image/video concept media, not just
        # 3D models. NULL/"3d" both mean 3D model, for rows written before this existed.
        if "model_kind" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN model_kind TEXT DEFAULT NULL")
        # voice_id/voice_description: AI-cast character voice, kept together so a
        # recast can reuse the description that produced the original voice.
        if "voice_id" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN voice_id TEXT DEFAULT NULL")
        if "voice_description" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN voice_description TEXT DEFAULT NULL")
        # type_label: custom category name for "other"-typed assets (e.g. "Faction",
        # "Clan") when lore/character/location/event doesn't fit.
        if "type_label" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN type_label TEXT DEFAULT NULL")


# ── Worlds ──────────────────────────────────────────────────────────────────

import json


def create_world(data: dict) -> dict:
    """Insert a world row and return the full row dict."""
    with _connect() as conn:
        conn.execute(
            """INSERT INTO worlds (id, name, persona_id, persona_label, description, eras, era_notes, ideas, dialects, roles, created_at)
               VALUES (:id, :name, :persona_id, :persona_label, :description, :eras, :era_notes, :ideas, :dialects, :roles, :created_at)""",
            {
                "id": data["id"],
                "name": data["name"],
                "persona_id": data["personaId"],
                "persona_label": data["personaLabel"],
                "description": data.get("description", ""),
                "eras": json.dumps(data["eras"]),
                "era_notes": json.dumps(data.get("eraNotes", {})),
                "ideas": json.dumps(data["ideas"]),
                "dialects": json.dumps(data.get("dialects", {})),
                "roles": json.dumps(data["roles"]),
                "created_at": data["createdAt"],
            },
        )
    return get_world(data["id"])


def get_world(world_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM worlds WHERE id = ?", (world_id,)).fetchone()
    return _row_to_world(row) if row else None


def update_world(world_id: str, data: dict) -> dict | None:
    fields = []
    params: dict = {}
    mapping = {
        "name": "name",
        "personaId": "persona_id",
        "personaLabel": "persona_label",
        "description": "description",
        "eras": "eras",
        "eraNotes": "era_notes",
        "ideas": "ideas",
        "dialects": "dialects",
        "roles": "roles",
    }
    json_fields = {"eras", "eraNotes", "ideas", "dialects", "roles"}
    for key, col in mapping.items():
        if key in data:
            fields.append(f"{col} = :{col}")
            params[col] = json.dumps(data[key]) if key in json_fields else data[key]
    if not fields:
        return get_world(world_id)
    params["id"] = world_id
    with _connect() as conn:
        conn.execute(f"UPDATE worlds SET {', '.join(fields)} WHERE id = :id", params)
    return get_world(world_id)


def _row_to_world(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "personaId": row["persona_id"],
        "personaLabel": row["persona_label"],
        "description": row["description"] or "",
        "eras": json.loads(row["eras"]),
        "eraNotes": json.loads(row["era_notes"] or "{}"),
        "ideas": json.loads(row["ideas"]),
        "dialects": json.loads(row["dialects"]),
        "roles": json.loads(row["roles"]),
        "createdAt": row["created_at"],
    }


# ── Assets ───────────────────────────────────────────────────────────────────

def create_asset(world_id: str, data: dict) -> dict:
    with _connect() as conn:
        conn.execute(
            """INSERT INTO assets (id, world_id, title, type, type_label, era, faction, mood, content, offline, created_at, source_asset_id, status, source_document_id)
               VALUES (:id, :world_id, :title, :type, :type_label, :era, :faction, :mood, :content, :offline, :created_at, :source_asset_id, :status, :source_document_id)""",
            {
                "id": data["id"],
                "world_id": world_id,
                "title": data["title"],
                "type": data["type"],
                "type_label": data.get("typeLabel") or None,
                "era": data["era"],
                "faction": data.get("faction", "—"),
                "mood": data.get("mood", "neutral"),
                "content": data["content"],
                "offline": 1 if data.get("offline") else 0,
                "created_at": data["createdAt"],
                "source_asset_id": data.get("source_asset_id"),
                "status": data.get("status", "confirmed"),
                "source_document_id": data.get("source_document_id"),
            },
        )
    return get_asset(data["id"])


def get_asset(asset_id: int) -> dict | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    return _row_to_asset(row) if row else None


def list_assets(world_id: str, type_filter: str | None = None) -> list[dict]:
    with _connect() as conn:
        if type_filter:
            rows = conn.execute(
                "SELECT * FROM assets WHERE world_id = ? AND type = ? ORDER BY created_at ASC",
                (world_id, type_filter),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM assets WHERE world_id = ? ORDER BY created_at ASC",
                (world_id,),
            ).fetchall()
    return [_row_to_asset(r) for r in rows]


def find_asset_by_source(world_id: str, source_asset_id: int, era: str) -> dict | None:
    """Return the shifted asset for a given source + era combo, if one exists."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM assets WHERE world_id = ? AND source_asset_id = ? AND era = ?",
            (world_id, source_asset_id, era),
        ).fetchone()
    return _row_to_asset(row) if row else None


def update_asset(asset_id: int, data: dict) -> dict:
    """Update mutable fields on an existing asset and return the refreshed row."""
    fields = []
    params: dict = {}
    # Note: created_at is deliberately excluded — an era-shift update-in-place
    # should not bump the entry's position in created_at-ordered lists every
    # time the same subject+era combo is re-shifted.
    mapping = {
        "title": "title",
        "type": "type",
        "era": "era",
        "faction": "faction",
        "mood": "mood",
        "content": "content",
        "typeLabel": "type_label",
        "offline": "offline",
        "status": "status",
        "source_document_id": "source_document_id",
        "portrait_prompt": "portrait_prompt",
        "portrait_seed": "portrait_seed",
        "model_path": "model_path",
        "model_source": "model_source",
        "model_status": "model_status",
        "model_error": "model_error",
        "model_added_at": "model_added_at",
        "model_kind": "model_kind",
        "voice_id": "voice_id",
        "voice_description": "voice_description",
    }
    for key, col in mapping.items():
        if key in data:
            fields.append(f"{col} = :{col}")
            val = data[key]
            if key == "offline":
                val = 1 if val else 0
            params[col] = val
    if not fields:
        return get_asset(asset_id)
    params["id"] = asset_id
    with _connect() as conn:
        conn.execute(f"UPDATE assets SET {', '.join(fields)} WHERE id = :id", params)
    return get_asset(asset_id)


def rename_asset_era(world_id: str, old_era: str, new_era: str) -> int:
    """Cascade an era rename to every asset in a world tagged with old_era.
    Returns the number of assets updated. Used by both the dedicated rename
    endpoint and the remove-with-merge path, so renaming or removing an era
    never silently orphans existing canon entries."""
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE assets SET era = ? WHERE world_id = ? AND era = ?",
            (new_era, world_id, old_era),
        )
    return cur.rowcount


def count_assets_by_era(world_id: str, era: str) -> int:
    with _connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM assets WHERE world_id = ? AND era = ?",
            (world_id, era),
        ).fetchone()
    return row["c"] if row else 0


def delete_asset(asset_id: int) -> bool:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM assets WHERE id = ?", (asset_id,))
    return cur.rowcount > 0


def _row_to_asset(row) -> dict:
    result = {
        "id": row["id"],
        "worldId": row["world_id"],
        "title": row["title"],
        "type": row["type"],
        "era": row["era"],
        "faction": row["faction"],
        "mood": row["mood"],
        "content": row["content"],
        "createdAt": row["created_at"],
        "status": row["status"],
    }
    if row["offline"]:
        result["offline"] = True
    src = row["source_asset_id"]
    if src is not None:
        result["sourceAssetId"] = src
    src_doc = row["source_document_id"]
    if src_doc is not None:
        result["sourceDocumentId"] = src_doc
    if row["portrait_prompt"]:
        result["portraitPrompt"] = row["portrait_prompt"]
        result["portraitSeed"] = row["portrait_seed"]
    if row["model_status"]:
        result["modelStatus"] = row["model_status"]
        if row["model_path"]:
            result["modelPath"] = row["model_path"]
        if row["model_source"]:
            result["modelSource"] = row["model_source"]
        if row["model_error"]:
            result["modelError"] = row["model_error"]
        if row["model_added_at"]:
            result["modelAddedAt"] = row["model_added_at"]
        # Rows written before model_kind existed (or the Blender/CharMorph
        # path, which never sets it) are always a 3D model.
        result["modelKind"] = row["model_kind"] or "3d"
    if row["voice_id"]:
        result["voiceId"] = row["voice_id"]
        result["voiceDescription"] = row["voice_description"] or ""
    if row["type_label"]:
        result["typeLabel"] = row["type_label"]
    return result


# ── Documents (Feature 1: script/doc ingestion) ──────────────────────────────

def create_document(data: dict) -> dict:
    with _connect() as conn:
        conn.execute(
            """INSERT INTO documents (id, world_id, title, raw_text, created_at)
               VALUES (:id, :world_id, :title, :raw_text, :created_at)""",
            data,
        )
    return get_document(data["id"])


def get_document(document_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
    return _row_to_document(row) if row else None


def list_documents(world_id: str) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM documents WHERE world_id = ? ORDER BY created_at DESC", (world_id,)
        ).fetchall()
    return [_row_to_document(r) for r in rows]


def _row_to_document(row) -> dict:
    return {
        "id": row["id"],
        "worldId": row["world_id"],
        "title": row["title"],
        "rawText": row["raw_text"],
        "createdAt": row["created_at"],
    }


def find_asset_by_name(world_id: str, title: str, type_: str) -> dict | None:
    """Case-insensitive exact-name match within a type, used by ingestion's
    diff step (Feature 1). A simple v1 — swap for fuzzy/similarity matching
    later without changing callers."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM assets WHERE world_id = ? AND type = ? AND LOWER(title) = LOWER(?) LIMIT 1",
            (world_id, type_, title),
        ).fetchone()
    return _row_to_asset(row) if row else None


def find_asset_matches(world_id: str, title: str, type_: str) -> dict | None:
    """v2 of find_asset_by_name: tries an exact match first, then falls back
    to a fuzzy/alias match (substring containment or a high similarity
    ratio) so near-duplicate names (nicknames, minor spelling variants,
    "Mareth" vs "Mareth Soll") still surface as a match instead of silently
    creating a duplicate entry. Returns {"asset": ..., "confidence": "exact"
    | "likely"} or None. find_asset_by_name itself is left untouched so any
    other caller relying on strict exact-match behavior is unaffected."""
    exact = find_asset_by_name(world_id, title, type_)
    if exact:
        return {"asset": exact, "confidence": "exact"}

    title_lower = title.lower().strip()
    if len(title_lower) < 3:
        return None

    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM assets WHERE world_id = ? AND type = ?", (world_id, type_)
        ).fetchall()

    best_row, best_score = None, 0.0
    for row in rows:
        candidate_lower = (row["title"] or "").lower().strip()
        if len(candidate_lower) < 3:
            continue
        contains = title_lower in candidate_lower or candidate_lower in title_lower
        ratio = difflib.SequenceMatcher(None, title_lower, candidate_lower).ratio()
        if not (contains or ratio >= 0.82):
            continue
        score = max(ratio, 0.82) if contains else ratio
        if score > best_score:
            best_score, best_row = score, row

    if best_row is not None:
        return {"asset": _row_to_asset(best_row), "confidence": "likely"}
    return None


# ── Relationships (Feature 1 extension: persisted character/asset links) ────

def create_relationship(data: dict) -> dict:
    with _connect() as conn:
        conn.execute(
            """INSERT INTO relationships (id, world_id, asset_a_title, asset_b_title, context, source_document_id, created_at)
               VALUES (:id, :world_id, :asset_a_title, :asset_b_title, :context, :source_document_id, :created_at)""",
            data,
        )
    return get_relationship(data["id"])


def get_relationship(relationship_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM relationships WHERE id = ?", (relationship_id,)).fetchone()
    return _row_to_relationship(row) if row else None


def list_relationships(world_id: str) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM relationships WHERE world_id = ? ORDER BY created_at ASC", (world_id,)
        ).fetchall()
    return [_row_to_relationship(r) for r in rows]


def _row_to_relationship(row) -> dict:
    return {
        "id": row["id"],
        "worldId": row["world_id"],
        "a": row["asset_a_title"],
        "b": row["asset_b_title"],
        "context": row["context"],
        "sourceDocumentId": row["source_document_id"],
        "createdAt": row["created_at"],
    }


# ── Export version history (Export screen: "Version History") ──────────────
# Every successful /export compile is snapshotted so writers can page back
# through earlier drafts instead of losing them on regenerate. Read-only
# history, never read back into canon.

_EXPORT_HISTORY_KEEP = 30  # per world+docType — oldest beyond this are pruned


def create_export_version(data: dict) -> dict:
    with _connect() as conn:
        conn.execute(
            """INSERT INTO export_versions (id, world_id, doc_type, era, faction, asset_count, content, offline, created_at)
               VALUES (:id, :world_id, :doc_type, :era, :faction, :asset_count, :content, :offline, :created_at)""",
            {
                "id": data["id"],
                "world_id": data["world_id"],
                "doc_type": data["doc_type"],
                "era": data.get("era", ""),
                "faction": data.get("faction", ""),
                "asset_count": data.get("asset_count", 0),
                "content": data["content"],
                "offline": 1 if data.get("offline") else 0,
                "created_at": data["created_at"],
            },
        )
        # Prune anything past the keep-window for this world+docType, oldest
        # first, so history can't grow unbounded across a long project.
        stale = conn.execute(
            """SELECT id FROM export_versions WHERE world_id = ? AND doc_type = ?
               ORDER BY created_at DESC LIMIT -1 OFFSET ?""",
            (data["world_id"], data["doc_type"], _EXPORT_HISTORY_KEEP),
        ).fetchall()
        if stale:
            conn.executemany(
                "DELETE FROM export_versions WHERE id = ?", [(r["id"],) for r in stale]
            )
    return get_export_version(data["id"])


def get_export_version(version_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM export_versions WHERE id = ?", (version_id,)).fetchone()
    return _row_to_export_version(row) if row else None


def list_export_versions(world_id: str, doc_type: str) -> list[dict]:
    """Most-recent-first — matches how a version history list is read."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM export_versions WHERE world_id = ? AND doc_type = ? ORDER BY created_at DESC",
            (world_id, doc_type),
        ).fetchall()
    return [_row_to_export_version(r) for r in rows]


def delete_export_version(version_id: str) -> bool:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM export_versions WHERE id = ?", (version_id,))
    return cur.rowcount > 0


def _row_to_export_version(row) -> dict:
    return {
        "id": row["id"],
        "worldId": row["world_id"],
        "docType": row["doc_type"],
        "era": row["era"],
        "faction": row["faction"],
        "assetCount": row["asset_count"],
        "content": row["content"],
        "offline": bool(row["offline"]),
        "createdAt": row["created_at"],
    }
