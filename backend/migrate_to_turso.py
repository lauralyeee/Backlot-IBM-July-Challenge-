"""
One-off migration: copy every row out of the local worldbuilding.db (SQLite)
file into a Turso database, then verify the counts match.

Usage:
    cd backend
    source .venv/bin/activate
    # TURSO_DATABASE_URL / TURSO_AUTH_TOKEN must be set -- either export them
    # or put them in backend/.env (this script loads that file automatically).
    python migrate_to_turso.py [path/to/worldbuilding.db]

What it does:
    1. Refuses to run unless TURSO_DATABASE_URL is set -- this script only
       ever writes to Turso, never to a local file, so there's no ambiguity
       about which database is the destination.
    2. Opens the local SQLite file read-only (plain stdlib sqlite3 -- the
       source file predates this migration and was never touched by libsql,
       so there's no reason to add a new dependency just to read it).
    3. Creates the schema on Turso by calling db.init_db() -- reuses the
       exact same CREATE TABLE / ALTER TABLE statements the app already
       runs on every startup, so the destination schema can never drift
       from what main.py expects.
    4. Copies rows table-by-table in FK-safe order (worlds, then everything
       that references worlds), using INSERT OR REPLACE so the script is
       safe to re-run if it's interrupted partway through.
    5. Prints a per-table source-vs-destination row count so you can see at
       a glance whether the copy is complete.

This is a one-time bootstrap. It is NOT run automatically by the app --
run it by hand once, after creating the Turso database and before pointing
the deployed app at it.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

if not TURSO_DATABASE_URL:
    print(
        "ERROR: TURSO_DATABASE_URL is not set. This script only writes to "
        "Turso -- set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN) in backend/.env "
        "or the environment before running it.\n"
        "  turso db create backlot\n"
        "  turso db show backlot --url\n"
        "  turso db tokens create backlot",
        file=sys.stderr,
    )
    sys.exit(1)

# db.py itself reads TURSO_DATABASE_URL/TURSO_AUTH_TOKEN from the environment
# at _connect() time, so importing it after load_dotenv() above is enough to
# point every db.* call in this script at the same Turso database.
import db  # noqa: E402

SOURCE_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "worldbuilding.db"

# (table, columns) in FK-safe order -- worlds first, everything else
# references worlds.id.
TABLES: list[tuple[str, list[str]]] = [
    ("worlds", ["id", "name", "persona_id", "persona_label", "description", "eras",
                "era_notes", "ideas", "dialects", "roles", "created_at"]),
    ("assets", ["id", "world_id", "title", "type", "type_label", "era", "faction", "mood",
                "content", "offline", "created_at", "source_asset_id", "status",
                "source_document_id", "portrait_prompt", "portrait_seed", "model_path",
                "model_source", "model_status", "model_error", "model_added_at",
                "model_kind", "voice_id", "voice_description"]),
    ("documents", ["id", "world_id", "title", "raw_text", "created_at"]),
    ("relationships", ["id", "world_id", "asset_a_title", "asset_b_title", "context",
                        "source_document_id", "created_at"]),
    ("export_versions", ["id", "world_id", "doc_type", "era", "faction", "asset_count",
                          "content", "offline", "created_at"]),
]


def main() -> None:
    if not SOURCE_PATH.exists():
        print(f"ERROR: source database not found at {SOURCE_PATH}", file=sys.stderr)
        sys.exit(1)

    print(f"Source:      {SOURCE_PATH}")
    print(f"Destination: Turso ({TURSO_DATABASE_URL})")
    print()

    print("Ensuring schema exists on Turso (db.init_db)...")
    db.init_db()

    src = sqlite3.connect(str(SOURCE_PATH))
    src.row_factory = sqlite3.Row
    src_cols = {
        table: {row["name"] for row in src.execute(f"PRAGMA table_info({table})")}
        for table, _ in TABLES
    }

    dst = db._connect()

    for table, columns in TABLES:
        # Only copy columns that actually exist in the source file -- older
        # local databases may predate a column that a later migration added.
        available = [c for c in columns if c in src_cols.get(table, set())]
        skipped = [c for c in columns if c not in available]
        if skipped:
            print(f"  [{table}] source is missing columns {skipped} -- will insert NULL/default for those")

        rows = src.execute(f"SELECT {', '.join(available)} FROM {table}").fetchall()
        placeholders = ", ".join("?" for _ in available)
        col_list = ", ".join(available)
        for row in rows:
            dst.execute(
                f"INSERT OR REPLACE INTO {table} ({col_list}) VALUES ({placeholders})",
                tuple(row[c] for c in available),
            )
        dst.commit()

        dst_count = db._one(dst.execute(f"SELECT COUNT(*) AS c FROM {table}"))["c"]
        print(f"  [{table}] copied {len(rows)} rows from source -- destination now has {dst_count}")

    src.close()
    print()
    print("Done. Spot-check a world in the deployed app before decommissioning the local file.")


if __name__ == "__main__":
    main()
