# Backlot
AI worldbuilding assistant built on IBM Granite via watsonx.ai for the IBM AI Builders Challenge (July 2026, Creative Industries theme).

## Architecture
| Layer            | Technology                               |
|------------------|------------------------------------------|
| Frontend         | React 19 + Vite 8 (src/)                |
| Backend          | FastAPI (Python) — backend/             |
| LLM              | IBM Granite via watsonx.ai               |
| Structured store | Turso (libSQL) — local SQLite fallback for dev |
| Retrieval        | Custom term-overlap relevance scorer     |
| Voice            | Browser Web Speech API                   |

### Design decisions
- **Credentials server-side only.** WATSONX_API_KEY and WATSONX_PROJECT_ID live in backend/.env and are never sent to the browser. The frontend calls /api/* → Vite proxy → FastAPI backend, which holds all IBM credentials.
- **Custom retrieval, no LangChain.** The retrieval layer (backend/retrieval.py) is a lightweight weighted term-overlap scorer — same algorithm as src/lib/retrieval.js but now running server-side before every generation call. Swappable behind the same interface if a vector store is added later.
- **Turso (libSQL), not localStorage.** World state (worlds, assets) persists in Turso — required once the backend runs on Vercel's serverless functions, since a local SQLite file wouldn't survive a cold start or be shared across instances. backend/db.py falls back to a local SQLite file (via the same libsql engine) when TURSO_DATABASE_URL isn't set, so local dev works without a Turso account, but it's recommended to set up Turso locally too before deploying. The only thing still in localStorage is non-sensitive UI state (world ID reference + dark/light mode).
- **Two-pass generation.** Content is generated in one call; a second lightweight classification call then independently assigns type, era, faction, and mood tags (Tier 2 auto-tagging, best-effort).
- 
## Running locally
### Prerequisites
- Node.js 18+
- Python 3.11+
- An IBM Cloud account with a watsonx.ai project and API key
backend/.env is already set up with a working WATSONX_API_KEY and WATSONX_PROJECT_ID — no credentials setup needed, just install and run.
> Note: .env is gitignored (see .env.example for the shape it takes) so it won't come through if you git clone the repo fresh — if that's how you got the code, ask Laura to send you backend/.env directly rather than trying to recreate it from the example file.
### Backend
bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

> PDF/DOCX upload (the Import file feature) needs Docling, which is deliberately left out of requirements.txt -- it's a heavy install (torch/transformers/etc.) that would blow past Vercel's per-function size limit, and the route is hardcoded off in the deployed app anyway. To test it locally, install from requirements-local.txt instead: pip install -r requirements-local.txt.
Without any TURSO_* env vars set, this reads/writes the local backend/worldbuilding.db file exactly as before — no Turso account needed to get started.
#### Setting up Turso (recommended before deploying)
bash
# Install the Turso CLI, then:
turso db create backlot
turso db show backlot --url        # -> TURSO_DATABASE_URL
turso db tokens create backlot     # -> TURSO_AUTH_TOKEN

Add both values to backend/.env (see backend/.env.example). Once TURSO_DATABASE_URL is set, db.py connects to Turso instead of the local file. If you already have data in backend/worldbuilding.db, copy it over once:
bash
cd backend
python migrate_to_turso.py

### Frontend
bash
# In the project root
npm install
npm run dev

Open http://localhost:5173. The Vite dev server proxies /api/* to the backend on port 8000. To confirm the backend can reach watsonx, hit GET http://localhost:8000/api/ping.

## API endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/worlds | Create world + seed assets |
| GET | /api/worlds/{id} | Get world metadata |
| PATCH | /api/worlds/{id} | Update world metadata |
| GET | /api/worlds/{id}/assets | List assets (optional ?type=) |
| POST | /api/worlds/{id}/assets | Save an asset |
| POST | /api/worlds/{id}/generate | Generate (expand / character / era_shift) |
| POST | /api/worlds/{id}/audit | Consistency audit |
| POST | /api/worlds/{id}/ask | Q&A (lore or character chat) |
| GET | /api/ping | Test watsonx connection |
| GET | /api/models | List available foundation models |

## Model chain
The backend uses ibm/granite-4-h-small → ibm/granite-3-3-8b-instruct (see MODEL_CHAIN in backend/watsonx.py). IBM periodically deprecates model IDs. If you see "model not found" errors, call GET /api/models to see what's currently available on your project and update MODEL_CHAIN.
## Screens
| Screen | Feature |
|--------|---------|
| Home | Landing — quick-start cards, recent entries, stats |
| World Book | Canon library, search/filter, consistency audit |
| Add to World | Gap-Filling Engine (expand idea or generate character), grounding context panel |
| Characters | NPC cast generator, lore Q&A, character chat with Web Speech voice |
| Timeline | Time-Shift Mode — re-render any entry in another era |
| Settings | Connection test, roles, persona, theme, world name, reset
