# Backlot

Backlot is a worldbuilding workspace for writers, game designers, and interactive media teams with an AI co-pilot built in. Built by Laura Lai and Henry Khoo for the IBM Bob AI Builders Challenge, July 2026.

## Problem

Writers, producers, and worldbuilders working on games and interactive media rarely struggle with the story itself. The hard part is everything that happens after such as keeping character details straight across dozens of entries, making sure episode nine doesn't quietly contradict episode two, and eventually turning all of it into something you can actually hand to a producer. Every character also needs a real voice and a face, and not just a paragraph of description. A producer or director trying to visualize, concept, or cast a project needs to actually feel who these people are. Most solo writers and small teams don't have a writers' room or an art department to do any of that for them, so a lot of good worldbuilding stays stuck in a messy notes doc.

## Solution

Feed Backlot whatever you already have, a single sentence, a full pitch script, half an idea, and it grows that into a structured, internally consistent world. The characters, locations, and a timeline are all grounded in whatever canon already exists so nothing comes back generic or contradicts what you've already built.

You can paste or upload a script, treatment, or pitch document and Backlot will read it and propose characters, locations, and timeline events for you to approve. No changes get added without a review step. You can type one line and watch it expand into a full character or lore entry. Generated characters can be cast with a real, AI generated voice and chatted with in character. Any asset can get a portrait or a piece of concept art, either generated or uploaded from your own reference material. Timeline entries can be shifted into a different era to see how a character or place looked years earlier or later without breaking anything already written. When it's time to actually pitch the project, Export compiles the world into a real document. The character bios, a world bible, a beat sheet, a full pitch packet, or a Fountain format script instead of leaving everything trapped inside the app.

The goal isn't to replace the writer. It's to give one person the production support that used to take a whole team. The process of getting from an idea to something pitchable doesn't depend on having that team.

## Selected challenge theme

We picked the July 2026 theme, **Creative Industries**. Backlot helps by taking over the production grunt work around a story, consistency, casting, visualization, and formatting, so a solo creator gets the kind of support that used to require a whole team.

## AI approach and architecture

**IBM Granite**, served through **watsonx.ai**, is the core model behind almost everything Backlot generates: expanding a fragment into a full canon entry, drafting new characters, powering in character chat, re rendering an entry for a different era, tagging every asset with its type/era/faction/mood after it's generated, running a consistency audit across the whole world, extracting structured entries out of an uploaded script, and briefing the voice and portrait pipelines described below. The primary model is `ibm/granite-4-h-small`, with `mistralai/mistral-medium-2505` as a live, verified fallback if Granite is unreachable on a given account or region.

Grounding is handled by a small custom retrieval layer rather than a vector database. Every generation call pulls the most relevant existing canon entries using a weighted term overlap scorer with a recency tiebreaker, implemented once server side in `backend/retrieval.py`. That was a deliberate choice over **LangChain** or a vector store: the app's canon is small enough per world that a lightweight, fully understood scorer is more reliable to build on and debug than an embedding pipeline would be, and it keeps the whole grounding step swappable behind one function signature if that ever changes.

Document ingestion goes through **IBM Docling**, which converts an uploaded PDF or DOCX into clean markdown before Granite extracts structured characters, locations, and timeline markers from it. Plain text and Fountain screenplay uploads skip Docling entirely since they're already plain text.

Two more AI services round out the creative side. Character voices are cast through **Google Gemini text to speech**: Granite drafts a short voice description from the character's canon sheet, that description is matched against a fixed pool of prebuilt voices, and the description itself is replayed as style direction on every future line so the same character keeps sounding like themselves. If Gemini TTS is ever unavailable, the app falls back to the browser's own **Web Speech API** rather than going silent. Portraits and other concept art are rendered through **Pollinations**, an AI image generator, using a prompt Granite drafts from the asset's canon plus a fixed seed, so the same character always renders the same face. Character 3D concept models go one step further: Granite classifies a handful of body form parameters from the canon text, and a headless **Blender** process running **CharMorph** applies them to a base mesh and exports a viewable model, rendered in the browser through Google's **`<model-viewer>`**.

Export is the one part of the pipeline that makes no AI calls at all. It compiles already generated canon into Markdown or Fountain, then converts that into a downloadable PDF, DOCX, or Fountain file entirely offline, so it's safe and fast to run live even during a demo.

| Layer | Technology |
|---|---|
| Frontend | **React** 19 + **Vite** 8 (`src/`) |
| Backend | **FastAPI**, Python (`backend/`) |
| Core LLM | **IBM Granite** via **watsonx.ai** |
| Document parsing | **IBM Docling** (PDF/DOCX to markdown) |
| Retrieval | Custom weighted term overlap scorer, no vector store |
| Structured store | **SQLite**, WAL mode (`backend/worldbuilding.db`) |
| Voice | **Google Gemini TTS**, with **Web Speech API** as a fallback |
| Portraits and concept art | **Pollinations.ai** (Flux model) |
| 3D concept models | Headless **Blender** + **CharMorph**, viewed via **`<model-viewer>`** |


## How IBM Bob was used

IBM Bob was the primary development tool for this project. The large majority of the frontend screens and components, and the FastAPI backend's endpoints, generation logic, ingestion pipeline, and export system, were written by Bob from scoped, written prompts rather than typed by hand.

To keep Bob's output consistent across a project built over many separate sessions, the repo carries an `AGENTS.md` file that Bob reads before making changes. It records a short list of locked architectural decisions such as no LangChain or vector store, credentials never leave the backend, SQLite only, and the two pass auto tagging design. There is also a set of non obvious patterns in the codebase that aren't visible from the code alone like the snake_case to camelCase conversion boundary between SQLite and the API or why `src/lib/storage.js` is a legacy file that shouldn't be reused. That file is what let Bob keep extending the app correctly without re deriving the same context and design decisions from scratch every session.

## API endpoints

| Method | Path | Description |
|---|---|---|
| POST | /api/worlds | Create a world, optionally with seed assets |
| GET | /api/worlds/{id} | Get world metadata |
| PATCH | /api/worlds/{id} | Update world metadata |
| GET | /api/worlds/{id}/assets | List assets, optional `?type=` filter |
| POST | /api/worlds/{id}/assets | Save an asset |
| PATCH | /api/worlds/{id}/assets/{aid} | Edit an asset |
| DELETE | /api/worlds/{id}/assets/{aid} | Delete an asset |
| POST | /api/worlds/{id}/generate | Generate (expand, character, or era shift) |
| POST | /api/worlds/{id}/audit | Consistency audit across the world |
| POST | /api/worlds/{id}/ask | Q&A: lore questions or in character chat |
| POST | /api/personas/custom | Generate a persona from a free text description |
| POST | /api/worlds/{id}/ingest | Extract proposed entries from pasted text |
| POST | /api/worlds/{id}/ingest/file | Docling: extract proposed entries from a PDF/DOCX/TXT/Fountain upload |
| POST | /api/worlds/{id}/ingest/commit | Persist approved extracted entries |
| POST | /api/worlds/{id}/export | Compile assets into a Markdown/Fountain document |
| POST | /api/worlds/{id}/export/download | Convert a compiled document to PDF, DOCX, or Fountain |
| GET | /api/worlds/{id}/export/history | List past export versions |
| POST | /api/worlds/{id}/eras/rename | Rename an era across every tagged asset |
| POST | /api/worlds/{id}/eras/describe | AI draft short descriptions for eras that lack one |
| POST | /api/worlds/{id}/assets/{aid}/portrait | Draft and store a visual portrait prompt |
| POST | /api/worlds/{id}/assets/{aid}/voice/design | Draft a voice and preview clip for a character |
| POST | /api/worlds/{id}/assets/{aid}/voice/confirm | Lock in a previewed voice permanently |
| POST | /api/worlds/{id}/assets/{aid}/voice/speak | Synthesize a reply in a character's cast voice |
| POST | /api/worlds/{id}/assets/{aid}/model3d/generate | Kick off a Blender/CharMorph 3D concept generation |
| POST | /api/worlds/{id}/assets/{aid}/model3d/upload | Upload your own 3D model, image, or video as concept media |
| GET | /api/ping | Test the watsonx connection |
| GET | /api/models | List available foundation models on your project |

## Model chain

The backend tries `ibm/granite-4-h-small` first, then falls back to `mistralai/mistral-medium-2505` (see `MODEL_CHAIN` in `backend/watsonx.py`). IBM periodically deprecates model IDs; if you see "model not found," call `GET /api/models` to see what's currently live on your project and update `MODEL_CHAIN`.

## Screens

| Screen | What it's for |
|---|---|
| Home | Landing page, quick start cards, recent entries, world stats |
| World Book | The canon library: search, filter, and run a consistency audit |
| Add to World | The gap filling engine: expand an idea or generate a new character, with a grounding panel showing what it drew on |
| Characters | The NPC cast, in character chat, and voice casting |
| Timeline | Time Shift Mode: re render any entry for a different era |
| Gallery | Visual reference library: generated 3D concept models and portraits, plus your own uploaded concept art, photos, or video |
| Import | Upload or paste a script/pitch doc and review what Backlot extracted from it before it's added to canon |
| Export | Compile the world into a character bible, pitch packet, beat sheet, or script, and download it as PDF, DOCX, or Fountain |
| Settings | Connection test, roles, persona, theme, world name, reset |
| Assistant | A chatbot that is powered by IBM Granite. It will detect the current page user is browsing and provide suggestions |

## Screenshots of the application
Home/ Landing page
<img width="1499" height="767" alt="image" src="https://github.com/user-attachments/assets/9fa9cb18-c317-4606-9e00-5e7ced4312a1" />

World Book
<img width="1499" height="767" alt="image" src="https://github.com/user-attachments/assets/a1f186e6-5c20-4631-92ea-c326aa683b20" />

Add to World
<img width="1498" height="770" alt="image" src="https://github.com/user-attachments/assets/eb3bd2b4-733c-4587-89a9-0a7e2caa4ccb" />

Characters
<img width="1499" height="767" alt="image" src="https://github.com/user-attachments/assets/ad7f343b-4d2f-42c8-a8ff-d72829422766" />

Timeline
<img width="1498" height="770" alt="image" src="https://github.com/user-attachments/assets/83704397-d3da-4eb4-a79c-bf3fb2df808d" />

Gallery
<img width="1499" height="767" alt="image" src="https://github.com/user-attachments/assets/40855e77-4e22-4f2f-b5f4-762640d61b99" />

Import
<img width="1499" height="767" alt="image" src="https://github.com/user-attachments/assets/774dd69d-bf65-48c2-850c-60e8e4ea99f1" />

Export
<img width="1499" height="767" alt="image" src="https://github.com/user-attachments/assets/25469505-be77-4612-b5d5-43c4fafa80fe" />

Settings
<img width="1499" height="767" alt="image" src="https://github.com/user-attachments/assets/25243dc4-7501-4ff4-ab1b-3d9c68eefd6b" />

Assistant
<img width="1498" height="770" alt="image" src="https://github.com/user-attachments/assets/3c3f3efd-b2e3-493a-a777-b384dbb1e043" />


## Link
[Live Hosted Website](https://ibmbacklot.vercel.app/) 

## Demo
[3-minute Demo](https://youtu.be/16FDa55rkA4)


## License
 
Backlot is licensed under the MIT License. Copyright (c) 2026 Laura Lai and Henry Khoo. See [LICENSE](LICENSE) for the full text.
 
 
## Third-Party Services & Attribution
 
Backlot calls out to several external models, APIs, and libraries. Each is used under its own license or terms of service, separate from this repository's MIT license:
 
- **IBM Granite** (`ibm/granite-4-h-small`) and **Mistral** (`mistralai/mistral-medium-2505`) — accessed via **watsonx.ai**, used under IBM's and Mistral's respective API terms.
- **IBM Docling** — open source document conversion library, used under its own license (Apache 2.0).
- **Google Gemini TTS** — accessed via API under Google's terms of service.
- **Web Speech API** — browser-native, used under the host browser's terms.
- **Pollinations.ai** — accessed via API under Pollinations' terms of service.
- **Blender** — used under the GNU General Public License (GPL).
- **CharMorph** — Blender add-on, used under its own license (verify GPL/AGPL terms before redistributing any bundled assets).
- **`<model-viewer>`** — Google, used under the Apache 2.0 License.
No license text for these third-party components is reproduced here; refer to each project's own repository or provider for their current terms.
 
