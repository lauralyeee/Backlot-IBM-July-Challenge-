# AGENTS.md

This file provides guidance to agents when working with code in this repository.

---

## Locked Architectural Decisions

These constraints must not be revisited without an explicit trade-off discussion:

- **LLM provider**: IBM Granite via watsonx.ai is the primary/showcased model. We deliberately lifted the "Granite only" restriction after a live `GET /api/models` check showed the configured fallback (`ibm/granite-3-3-8b-instruct`) isn't reachable on this account/region. It was replaced with a genuinely-live cross-provider fallback for real redundancy. `MODEL_CHAIN` is in `backend/watsonx.py`. If you see "model not found", call `GET /api/models` to discover live IDs and update `MODEL_CHAIN` there **and** mirror the comment in `src/lib/watsonx.js`.
  ```python
  MODEL_CHAIN = ["ibm/granite-4-h-small", "mistralai/mistral-medium-2505"]
  ```
- **Credentials**: `WATSONX_API_KEY` / `WATSONX_PROJECT_ID` live exclusively in `backend/.env`. Never prefix with `VITE_`, never import in `src/`.
- **Retrieval**: Custom term-overlap scorer in `backend/retrieval.py`. Do NOT add LangChain, LangFlow, or any vector-store. New implementations must keep the `retrieve_relevant()` signature.
- **Database**: SQLite only via `backend/db.py`. File defaults to `backend/worldbuilding.db`; override with `DB_PATH` env var. No other DB for Tier 1–3.
- **Auto-tagging**: Two-pass design is mandatory. `_auto_tag()` in `backend/main.py` runs *after* generation, *before* writing to SQLite. Do not merge into the generation call.
- **Frontend screens/layout**: There will be no changes on `src/styles/global.css`, Sidebar, TopBar, AssetCard, or `src/components/ui.jsx` primitives unless fixing a concrete usability bug.
- **Voice module**: `src/lib/voice.js` uses Web Speech API.

---

## Critical Non-Obvious Patterns

### Data flow: camelCase ↔ snake_case boundary
The SQLite schema uses `snake_case` column names (`world_id`, `created_at`, `persona_id`), but the API and all frontend code uses `camelCase` (`worldId`, `createdAt`, `personaId`). Conversion happens exclusively in `_row_to_world()` and `_row_to_asset()` in `backend/db.py`. Do not add conversion logic elsewhere.

### World object enrichment
Raw DB world rows do NOT include `rolesFull`. It is always attached by `_enrich_world()` in `backend/main.py` before being returned to the frontend, and also re-attached client-side in `App.jsx` via `ROLES.filter(...)`. When passing `world` to `generation.py` prompt builders (`persona_system()`, `schema_for()`), the dict must have `rolesFull` populated.

### Asset IDs are integers, world IDs are strings
World IDs are user-derived slugs (`name-timestamp`). Asset IDs are integer millisecond timestamps with a random suffix, generated in `normalize_asset()` / `offline_asset()` in `backend/generation.py`. The `AssetIn` Pydantic schema accepts `id: int`; the `WorldCreate` schema accepts `id: str`.

### `src/lib/storage.js` is a legacy stub
`storage.js` still exists and saves under the key `worldbuilding-copilot:poc:v1` (outdated). The active localStorage key used by `App.jsx` is `worldbuilding-copilot:ui:v2` and stores only `{ worldId, mode }`. All world content is in SQLite. Do not use `loadState()`/`saveState()` from `storage.js` for anything new.

### `src/lib/retrieval.js` and `src/lib/watsonx.js` are legacy reference files
These files are kept as documentation. No screen calls them directly. All AI calls go through `src/lib/api.js` → `/api/*` → FastAPI backend.

### watsonx.py token caching
`_token_cache` is a module-level dict — it persists for the lifetime of the uvicorn process. The IAM token is refreshed 60 seconds before expiry (`expires_in - 60`). This is intentional; do not add per-request token fetches.

### watsonx.py model fallback with last-good memory
`generate()` tries models in `MODEL_CHAIN` order, with 2 attempts per model (0.6 s sleep between). It also keeps `_last_good_model` as a process-level hint to try the previously working model first. A final fallback truncates the prompt to 400 chars.

### `backend/lib/worldData.py` mirrors only ROLES from JS
`backend/lib/worldData.py` intentionally contains only `ROLES` (not `PERSONAS`, `TYPES`, `TYPE_META`). `TYPES` is defined independently in `backend/generation.py`. Do not pull the full JS data structure into Python.

### WAL mode is always enabled
Every `_connect()` call in `db.py` runs `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON`. These are set per-connection; no global init is needed.

### Offline fallback path
All three generation endpoints (`/generate`, `/audit`, `/ask`) have try/except blocks that return offline-mode responses using `gen.offline_asset()`, `gen.offline_audit()`, `gen.offline_answer()`. Offline assets are flagged `"offline": True` in the response but are still saved to SQLite.

---

## Running the Project

```bash
# Terminal 1 — backend (must run from backend/ directory)
cd backend
pip install -r requirements.txt   # add requirements-local.txt instead if you need Docling (PDF/DOCX import) -- kept out of the deployed bundle, see requirements.txt comment
cp .env.example .env   # fill WATSONX_API_KEY and WATSONX_PROJECT_ID
uvicorn main:app --reload --port 8000

# Terminal 2 — frontend
npm install
npm run dev            # port 5173, proxies /api/* to port 8000
```

No test runner is configured. There is no lint config. Manual verification via `GET /api/ping` confirms watsonx connectivity.

---

## Stack

| Layer       | Technology                                    |
|-------------|-----------------------------------------------|
| Frontend    | React 19 + Vite 8 (ESM, no TypeScript)        |
| Backend     | FastAPI + uvicorn (Python)                    |
| LLM         | IBM Granite via watsonx.ai (`backend/watsonx.py`) |
| DB          | SQLite (`backend/db.py`, WAL mode)            |
| Retrieval   | Custom term-overlap (`backend/retrieval.py`)  |
| API client  | `src/lib/api.js` (all fetch calls, no library)|
| Voice       | Browser Web Speech API (`src/lib/voice.js`)   |
