# Backlot

An AI worldbuilding assistant for solo creators and small teams building games, interactive media, and pitch-ready story worlds.

Built by Laura and Henry for the IBM AI Builders Challenge, July 2026 — Creative Industries theme.

## Selected Challenge Theme

**Creative Industries.** Backlot sits across three of the challenge's example solution areas: a personalized creative assistant (it adapts to a specific world and cast of characters, not a generic prompt box), an AI-powered design and visual concept tool (portraits, 3D models, voice casting), and a storytelling/content-creation tool (canon, timeline, and pitch export). It's built to answer the challenge's core question directly: how AI can act as a creative partner rather than just a content generator, by keeping a human in the loop at every point where content joins canon.

## Problem Statement

Writers, producers, and worldbuilders working on games and interactive media rarely struggle with the story itself — the hard part is everything downstream of it. Keeping hundreds of details straight across a growing world. Casting and visualizing characters without an art department. Catching it when episode nine quietly contradicts episode two. Turning a world bible into something an investor or partner can actually read.

A studio solves this with a writers' room, an art department, and a production team. A solo creator or a two-person team has none of that, so the distance between "I have an idea" and "I have something pitchable" stays wide, slow, and dependent on skills most creators don't have on hand.

## Solution Description

Backlot takes whatever a creator already has — one sentence or a full script — and grows it into a structured, internally-consistent world.

- **Onboarding** turns a free-text world description into a starter persona, name suggestions, eras, and seed canon.
- **Import** parses an uploaded pitch script (PDF/DOCX) and extracts only what's actually in the text — characters, locations, props, timeline markers — into a review queue. Nothing reaches canon without explicit approval.
- **Create (Gap-Filling Engine)** expands a fragment — a name, a line, half an idea — into a full canon entry, grounded against the most relevant existing canon rather than generated in a vacuum.
- **Characters** generates an NPC from pinned traits (gender, age, appearance, personality), then casts a voice and renders a matching portrait — the same character renders the same face and voice every time.
- **Timeline (Time-Shift Mode)** re-renders any canon entry as it would exist in a different era, ageing or de-ageing it against a defined year gap.
- **World Book** auto-tags every entry (type, era, faction, mood) and runs a consistency audit across the whole canon library.
- **Gallery** turns a character's canon sheet into a real, orbit-able 3D model, and also holds any concept art, reference photos, or video a creator uploads directly.
- **Export** compiles approved canon and art into a Markdown, PDF, or DOCX pitch packet — a compile step, not a generation step, so it's fast and doesn't burn AI calls.

## AI Approach

Backlot deliberately uses different models for different creative jobs rather than one model for everything, because text reasoning, voice, portraiture, and 3D generation aren't the same problem:

- **IBM Granite (via watsonx.ai)** is the primary reasoning and generation engine for every piece of canon text — world details, character briefs, timeline shifts, tagging, and consistency auditing — with a live fallback chain to a second model if a Granite model ID is deprecated or unreachable.
- **IBM Docling** turns uploaded pitch scripts into clean text Granite can extract from, so Import works from whatever a creator already has instead of forcing them to re-type their world.
- **A custom term-overlap retrieval layer** (no LangChain, no vector database) grounds every generation call in the most relevant existing canon first, so expansions stay consistent with the world instead of drifting generic.
- **Google Gemini TTS and Pollinations.ai (Flux)** cast a voice and render a portrait from the same canon text Granite already produced, giving a character a consistent face and voice across sessions.
- **A headless Blender + CharMorph pipeline** reads AI-selected body-shape parameters off a character's canon sheet to produce a real, exportable 3D model.

The throughline is AI as a creative partner, not an autopilot: Import and Create both route through human review before anything joins canon, and Export never makes another AI call — it only compiles what a person already approved.

### Architecture

| Layer            | Technology                               |
|------------------|-------------------------------------------|
| Frontend         | React 19 + Vite 8 (`src/`)                |
| Backend          | FastAPI (Python), `backend/`              |
| LLM              | IBM Granite via watsonx.ai (`ibm/granite-4-h-small`, falling back to `mistralai/mistral-medium-2505`) |
| Document parsing | IBM Docling (PDF/DOCX → text)             |
| Voice            | Google Gemini TTS (`gemini-2.5-flash-preview-tts`), falling back to the browser's Web Speech API |
| Portrait art     | Pollinations.ai (Flux model), client-side, fixed seed per character |
| 3D generation    | Headless Blender + CharMorph, exported as `.glb`, rendered with `<model-viewer>` |
| Structured store | Turso (libSQL), local SQLite fallback for dev |
| Retrieval        | Custom term-overlap relevance scorer      |
| Build tool       | IBM Bob                                   |

## How IBM Bob Was Used

Bob was the primary development tool for Backlot end to end, not a one-off scaffold generated once and then hand-edited outside it. Two things in the repo show that concretely:

- **`AGENTS.md`** is the standing spec Bob worked from across sessions — it locks in architectural decisions that shouldn't be silently revisited (the choice of Granite as primary model with a live fallback chain, the custom no-vector-store retrieval layer, SQLite for the structured store, which frontend components are frozen against redesign) and documents non-obvious patterns in the codebase (the camelCase/snake_case boundary between the API and SQLite, how world objects get enriched before reaching the frontend, how asset IDs are generated, how the watsonx token cache and model-fallback logic behave). This let Bob pick up implementation work in a new session without re-deriving context that had already been figured out.
- **`.bob/rules-plan`, `.bob/rules-agent`, `.bob/rules-ask`** map to the three modes Bob was actually used in: planning mode for architecture and feature decisions, agent mode for implementing across the frontend and backend in the same pass, and ask mode for debugging — for example, diagnosing a watsonx model deprecation by querying `GET /api/models` for what was actually live and updating the fallback chain accordingly.

The build history reflects this: features like the Assistant chat widget, voice casting, portrait generation, era-based timeline rendering, and the Docling import path were each built and wired up through Bob rather than assembled once by hand.

## Demo

[Add the demo video link here]

### Screens

| Screen | Feature |
|--------|---------|
| Home | Landing, quick-start cards, recent entries, stats |
| Onboarding | World creation from a free-text description |
| Import | Upload a script (PDF/DOCX) via IBM Docling, review queue before anything joins canon |
| World Book | Canon library, search/filter, auto-tagging, consistency audit |
| Create | Gap-Filling Engine, expand a fragment into a full canon entry, grounding context panel |
| Characters | NPC generator with pinned traits, Gemini-cast voice, Pollinations portrait, lore Q&A, in-character chat |
| Timeline | Time-Shift Mode, re-render any entry in another era |
| Gallery | AI-generated 3D character models (Blender + CharMorph), plus your own uploaded concept art, photos, or video |
| Export | Compile canon and art into a Markdown, PDF, or DOCX pitch packet |
| Settings | Connection test, roles, persona, theme, world name, reset |

## Try It Yourself

### Prerequisites

- Node.js 18+
- Python 3.11+
- An IBM Cloud account with a watsonx.ai project and API key

`backend/.env` is already set up with a working `WATSONX_API_KEY` and `WATSONX_PROJECT_ID`. It's gitignored, so ask Laura for it directly if you cloned the repo fresh rather than trying to recreate it from `.env.example`.

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Without any `TURSO_*` env vars set, this reads/writes the local `backend/worldbuilding.db` file — no Turso account needed to get started.

> PDF/DOCX upload needs Docling, deliberately left out of `requirements.txt` (it's a heavy install that would blow past Vercel's per-function size limit, and the route is hardcoded off in the deployed app). To test it locally: `pip install -r requirements-local.txt`.

#### Setting up Turso (recommended before deploying)

```bash
turso db create backlot
turso db show backlot --url        # -> TURSO_DATABASE_URL
turso db tokens create backlot     # -> TURSO_AUTH_TOKEN
```

Add both to `backend/.env`. If you already have data in `backend/worldbuilding.db`, migrate it once with `python migrate_to_turso.py` from `backend/`.

### Frontend

```bash
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api/*` to the backend on port 8000. Confirm the backend can reach watsonx via `GET http://localhost:8000/api/ping`.

### API Endpoints

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

IBM periodically deprecates model IDs — if you see "model not found," call `GET /api/models` and update `MODEL_CHAIN` in `backend/watsonx.py`.

## Design Decisions

- **Credentials server-side only.** `WATSONX_API_KEY` and `WATSONX_PROJECT_ID` never leave `backend/.env`; the frontend only ever calls `/api/*`.
- **Custom retrieval, no LangChain.** `backend/retrieval.py` is a lightweight weighted term-overlap scorer, swappable behind the same interface if a vector store is added later.
- **Turso, not localStorage.** World state persists in Turso (libSQL) so it survives a serverless cold start; `db.py` falls back to local SQLite when no Turso URL is set. The only thing left in `localStorage` is non-sensitive UI state.
- **Two-pass generation.** Content generates in one call; a second lightweight call independently assigns type/era/faction/mood tags.

## Impact

Backlot isn't about replacing writers — it gives one person the production support that used to take a whole team, so getting from an idea to something pitchable doesn't depend on having that team. For a producer, the deliverable is the point: Export walks out with character breakdowns, a world bible, and art compiled into one real document, not notes trapped in an app. The review-gated Import pipeline and the World Book consistency audit mean that document can actually be trusted against the source material — and because retrieval, model fallback, and credential handling were built as production concerns rather than demo shortcuts, the same system that generates a pitch packet in a walkthrough is architected to keep working under real use.
