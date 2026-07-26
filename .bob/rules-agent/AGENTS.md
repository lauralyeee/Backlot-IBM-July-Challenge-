# Project Coding Rules (Non-Obvious Only)

## Backend Python

- `backend/main.py` imports sibling modules as bare names (`import db`, `import watsonx as wx`, `import generation as gen`, `import retrieval as ret`) — these only resolve when uvicorn is run from the `backend/` directory. Do not add package prefixes.
- All DB read/write goes through functions in `backend/db.py`. Never write raw SQL in `main.py` or `generation.py`.
- camelCase↔snake_case conversion happens **only** in `_row_to_world()` / `_row_to_asset()` in `db.py`. Do not add conversion logic in endpoints or generation helpers.
- Asset IDs: integer millisecond timestamps + random 0–999 suffix, generated in `normalize_asset()` / `offline_asset()` in `generation.py`. World IDs: slug strings (`name-timestamp`), generated client-side in `App.jsx`.
- `_enrich_world()` in `main.py` must be called before passing a world dict to any `generation.py` function — it attaches `rolesFull` which `persona_system()` requires.
- `_auto_tag()` must remain a separate async function called after `wx.generate()` and before `db.create_asset()`. Best-effort: wrap in try/except, silently keep generation-pass tags on failure.
- Pydantic models use `model_dump()` (Pydantic v2 API), not `.dict()`.

## Frontend JS/JSX

- All API calls must go through the named exports in `src/lib/api.js`. Do not call `fetch` directly in screens/components.
- `src/lib/storage.js`, `src/lib/retrieval.js`, and `src/lib/watsonx.js` are legacy stubs — do not import or extend them for new features.
- localStorage is used only for `{ worldId, mode }` under key `worldbuilding-copilot:ui:v2` in `App.jsx`. Do not persist world content, assets, or credentials to localStorage.
- UI primitives (`Btn`, `Chip`, `Field`, `Tag`, `SectionLabel`, `Busy`, `EmptyState`, `Banner`) are all in `src/components/ui.jsx`. Use them; do not create ad-hoc inline equivalents.
- `world` prop passed to screens always includes `rolesFull` (array of full role objects), added client-side via `ROLES.filter(r => world.roles.includes(r.id))`.
- Theme is toggled via `document.documentElement.setAttribute("data-theme", mode)`. All colour tokens come from CSS custom properties in `src/styles/global.css`.

## No test runner, no linter
There is no Jest, Vitest, ESLint, or Prettier config. Validate backend changes manually with `GET /api/ping` and spot-check endpoints.
