# Backlot

Backlot is an AI worldbuilding assistant for people who write, produce, or build worlds for games and interactive media. It is built on IBM Granite via watsonx.ai for IBM AI Builders Challenge (July 2026, Creative Industries theme) by Laura and Henry.

## Why

For a writer, producer, or worldbuilder, the story was never the hard part. The hard part is everything after it by keeping details straight, building out characters, casting them, drawing them, catching it when episode nine quietly contradicts episode two. Most people working on games and interactive media don't have a writers' room or an art department on call.

Backlot is built for people who are a solo creator or small team who needs the production support a studio would normally provide. Therefore, the process from getting an idea to something pitchable doesn't depend on having a whole team.

## How it works

The user can feed Backlot whatever they already have, one sentence or a full script, and it grows that into a structured world like characters, places, a timeline, etc. These are all checked against what's already in canon.

- **Onboarding.** A free-text world description is sufficient for Granite to draft a persona label, name suggestions, starter eras, and a list of seed canon entries.
- **Import.** Upload a pitch script (PDF or DOCX or Fountain or Text). IBM Docling parses the file into clean text, then Granite extracts characters, locations, props, and timeline markers from it, only what's actually in the text, nothing invented. Everything lands in a review queue; nothing is added to canon until it is approved.
- **Create (Gap-Filling Engine).** Start from a single line, a name, a place, half an idea, and Granite expands it into a full canon entry. A custom term-overlap retrieval layer pulls in the most relevant existing canon first, so the result stays grounded instead of generic.
- **Characters.** Generate a character with customizable traits (gender, age, appearance, personality). Granite drafts a voice-casting brief and a visual brief from the character's canon text. Google Gemini TTS casts an actual voice from a pool of 30 fixed voices, styled by accent and tone. Pollinations.ai (Flux model) renders a matching portrait from a fixed seed, so the same face renders every time.
- **Timeline (Time-Shift Mode).** Re-renders any canon entry as it would exist in a different era, ageing or de-ageing it based on the year gap defined.
- **World Book.** Every generated entry is auto-tagged with type, era, faction, and mood in the same generation call, plus a consistency audit across the canon library.
- **Gallery.** Granite reads a character's canon sheet to pick body-shape parameters, which a headless Blender process running CharMorph applies to produce a real `.glb` 3D model, viewable and orbit-able via `<model-viewer>`. Gallery isn't limited to generated models: any asset, character, location, event, or otherwise, can also carry the uploaded concept art, reference photos, or short video.
- **Export.** Compiles approved canon and art into a Markdown, PDF, or DOCX pitch packet. It's a compile step over what Granite already produced.

### Architecture

| Layer            | Technology                               |
|------------------|-------------------------------------------|
| Frontend         | React 19 + Vite 8 (`src/`)                |
| Backend          | FastAPI (Python), `backend/`              |
| LLM              | IBM Granite via watsonx.ai (`ibm/granite-4-h-small`, falling back to `mistralai/mistral-medium-2505`) |
| Document parsing | IBM Docling (PDF/DOCX/Fountain/text → text)             |
| Voice            | Google Gemini TTS (`gemini-2.5-flash-preview-tts`), falling back to the browser's Web Speech API |
| Portrait art     | Pollinations.ai (Flux model), client-side, fixed seed per character |
| 3D generation    | Headless Blender + CharMorph, exported as `.glb`, rendered with `<model-viewer>` |
| Structured store | Turso (libSQL), local SQLite fallback for dev |
| Retrieval        | Custom term-overlap relevance scorer      |
| Build tool       | IBM Bob                                   |

### Design decisions

- **Credentials server-side only.** The environmental variables and secrets are stored securely. The frontend calls `/api/*`, Vite proxy via FastAPI backend.
- **Custom retrieval, no LangChain.** The retrieval layer (`backend/retrieval.py`) is a lightweight weighted term-overlap scorer. I
- **Turso (libSQL), not localStorage.** World state (worlds, assets) persists in Turso. 
- **Two-pass generation.** Content is generated in one call. A second lightweight classification call then independently assigns `type`, `era`, `faction`, and `mood` tags based on Tier 2 auto-tagging and best-effort.

## Demo

[https://www.youtube.com/watch?v=16FDa55rkA4]

### Screens

| Screen | Feature |
|--------|---------|
| Home | Landing page with quick-start cards, recent entries and stats |
| Onboarding | World creation from a free-text description |
| Import | Upload a script (PDF/DOCX/Fountain/Text) via IBM Docling. User can review queue before anything joins canon |
| World Book | Canon library, search/filter, auto-tagging and consistency audit |
| Create | Gap-Filling Engine that expands a fragment into a full canon entry, grounding context panel |
| Characters | NPC generator with pinned traits, Gemini-cast voice, Pollinations portrait, lore Q&A and in-character chat |
| Timeline | Time-Shift Mode which re-render any entry in another era |
| Gallery | AI-generated 3D character models (Blender + CharMorph) and user can upload concept art, photos, or video for any asset |
| Export | Compile canon and art into a Markdown, PDF, or DOCX pitch packet |
| Settings | Connection test, roles, persona, theme, world name and reset |


#### Prerequisites 

- Node.js 18+
- Python 3.11+
- An IBM Cloud account with a watsonx.ai project and API key

#### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

##### Setting up Turso 

```bash
# Install the Turso CLI, then:
turso db create backlot
turso db show backlot --url       
turso db tokens create backlot    
```


#### Frontend

```bash
# In the project root
npm install
npm run dev
```

#### API endpoints

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

#### Model chain

The backend uses `ibm/granite-4-h-small`, falling back to `mistralai/mistral-medium-2505`.

## Impact

Backlot is not about replacing writers. It gives one person the production support that used to take a whole team. Therefore, getting from an idea to something pitchable does not depend on having that team.

For a producer, the deliverable is the most crucial work. Export provides character breakdowns, a world bible, and art compiled into one real document. The review-gated Import pipeline will only joins canon with approval and the consistency audit in World Book allows document to be verified and trusted against the source material.The fallback model chain and credential handling were built as production concerns.



## Link
This application is hosted using Vercel. Note: Some functionalities are disabled due to technical constaints in production environment. The features like 3D generation and import functionality in production environment would be considered for future work. 
[https://ibm-july-challenge-backlot.vercel.app/]
