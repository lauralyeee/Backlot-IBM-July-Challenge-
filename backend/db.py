"""
SQLite database layer for the Worldbuilding Co-Pilot.
Tables: worlds, assets.
"""

import sqlite3
import os
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
        """)
        # Migration: add source_asset_id column if it doesn't exist yet
        # (safe to run every startup — ALTER TABLE is a no-op when already present)
        existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(assets)").fetchall()}
        if "source_asset_id" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN source_asset_id INTEGER DEFAULT NULL")
        # Migration: status ("confirmed" | "unconfirmed") + source_document_id,
        # added for Feature 1 (script ingestion). Same additive pattern as
        # source_asset_id above — Feature 3 (The Loop) reuses source_document_id
        # for its own re-import/re-export sync, so it doesn't need its own migration.
        if "status" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'")
        if "source_document_id" not in existing_cols:
            conn.execute("ALTER TABLE assets ADD COLUMN source_document_id TEXT DEFAULT NULL")


# ── Worlds ──────────────────────────────────────────────────────────────────

import json


def create_world(data: dict) -> dict:
    """Insert a world row and return the full row dict."""
    with _connect() as conn:
        conn.execute(
            """INSERT INTO worlds (id, name, persona_id, persona_label, eras, ideas, dialects, roles, created_at)
               VALUES (:id, :name, :persona_id, :persona_label, :eras, :ideas, :dialects, :roles, :created_at)""",
            {
                "id": data["id"],
                "name": data["name"],
                "persona_id": data["personaId"],
                "persona_label": data["personaLabel"],
                "eras": json.dumps(data["eras"]),
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
        "eras": "eras",
        "ideas": "ideas",
        "dialects": "dialects",
        "roles": "roles",
    }
    json_fields = {"eras", "ideas", "dialects", "roles"}
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
        "eras": json.loads(row["eras"]),
        "ideas": json.loads(row["ideas"]),
        "dialects": json.loads(row["dialects"]),
        "roles": json.loads(row["roles"]),
        "createdAt": row["created_at"],
    }


# ── Assets ───────────────────────────────────────────────────────────────────

def create_asset(world_id: str, data: dict) -> dict:
    with _connect() as conn:
        conn.execute(
            """INSERT INTO assets (id, world_id, title, type, era, faction, mood, content, offline, created_at, source_asset_id, status, source_document_id)
               VALUES (:id, :world_id, :title, :type, :era, :faction, :mood, :content, :offline, :created_at, :source_asset_id, :status, :source_document_id)""",
            {
                "id": data["id"],
                "world_id": world_id,
                "title": data["title"],
                "type": data["type"],
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
        "offline": "offline",
        "status": "status",
        "source_document_id": "source_document_id",
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
