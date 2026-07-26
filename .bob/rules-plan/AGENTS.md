# Project Architecture Rules (Non-Obvious Only)

## Hard constraints

- No LLM providers other than IBM Granite/watsonx.ai. No LangChain, LangFlow, Chroma, or vector DB.
- No DB other than SQLite for Tier 1–3. `DB_PATH` env var is the only supported override.
- Two-pass generation is mandatory: content generation → `_auto_tag()` → write to SQLite. These cannot be merged.
- Frontend screen layouts and `global.css` are frozen — only fix concrete usability bugs.

## Hidden coupling to know before changing things

- **`generation.py` requires `rolesFull`**: `persona_system()` calls `world["rolesFull"]` — if you add a new endpoint that calls any `generation.py` function, you must call `_enrich_world()` first or pass in a world dict with `rolesFull` already populated.
- **Backend imports require `backend/` CWD**: `main.py` does `import db`, `import watsonx as wx`, etc. as bare names. These only resolve when uvicorn starts from `backend/`. Any new backend module must follow the same convention.
- **`_last_good_model` is process-global state in `watsonx.py`**: It persists across requests within one uvicorn process. Restarting the server resets it. This is intentional for latency; don't add locking.
- **IAM token is process-global**: `_token_cache` in `watsonx.py` is shared across all concurrent requests. It is not thread/async-safe beyond the fact that uvicorn uses a single event loop — do not move it to a database or cache store.
- **`worldData.js` and `worldData.py` must stay in sync for ROLES**: The `id`, `label`, and `voice` fields are used both client-side (UI display) and server-side (prompt construction). If you add a role, update both files.

## Generation flow (end-to-end)

```
Frontend screen
  → src/lib/api.js generateAsset()
  → POST /api/worlds/{id}/generate
  → backend/main.py generate_asset()
      ├─ retrieval.py canon_block()   ← top-10 relevant assets as prompt context
      ├─ generation.py persona_system() + schema_for()  ← prompt builders
      ├─ watsonx.py generate()        ← MODEL_CHAIN with fallback + retry
      ├─ watsonx.py parse_json()      ← strips markdown fences, extracts first {...}
      ├─ generation.py normalize_asset()
      ├─ _auto_tag()                  ← second model call, best-effort
      └─ db.create_asset()
  → returns { asset, grounding }
```

On any exception in the try block, `gen.offline_asset()` is called and saved to SQLite with `offline: True`.

## Scope boundary

`src/lib/generation.js` and `src/lib/retrieval.js` exist but are not wired to any screen. They represent the pre-migration POC. The canonical implementations are the Python files in `backend/`.
