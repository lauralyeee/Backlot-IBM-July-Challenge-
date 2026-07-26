# Build brief for IBM Bob — IBMJuly (Worldbuilding Co-Pilot)

Paste this as your first message to Bob in Agent mode, after running `/init`
on this repo. It scans the existing code and writes `AGENTS.md` + `.bob/` —
do that first so Bob has full repo context before reading the rest of this.

---

## What this project is

AI Worldbuilding Co-Pilot for the AI Builders Challenge (July theme:
Creative Industries, submission deadline July 31, 2026, 11:59 PM ET). Full
requirements are in `AI_Worldbuilding_Copilot_Proposal.pdf` in the parent
folder — read it before starting. This repo (`IBMJuly/`) is a working
React/Vite frontend prototype (built as a UX/architecture reference, not by
Bob) that already implements the UI, the onboarding flow, and client-side
versions of all three MVP features. Your job is NOT to redesign the UI —
keep the screens, layout, and design system as they are unless a task below
says otherwise. Your job is to build the real backend and data layer this
currently fakes client-side, and to close the remaining gaps against the
proposal.

## Current state (read before changing anything)

- Pure Vite/React SPA, no backend — everything runs in the browser.
- `src/lib/watsonx.js` — calls watsonx.ai directly from the browser via a
  Vite dev proxy (`/iam`, `/wx`). Model chain and a live-model-list fallback
  were just fixed (see "Known-good as of now" below) — don't revert this.
- `src/lib/retrieval.js` — a hand-rolled term-overlap relevance scorer
  standing in for a real retrieval pipeline. No vector database, no
  LangChain/LangFlow.
- `src/lib/storage.js` — world state persists to `localStorage`. No SQLite,
  no relational store, no vector store.
- `src/lib/voice.js` — uses the browser's Web Speech API for the Dialect &
  Voice stretch goal. No AI model involved in voice generation — this is
  fine to keep as-is, it's a legitimate lightweight implementation.
- Screens: `Home`, `WorldBook` (Gap-Filling Engine + canon library),
  `Create` (fragment → generation), `Characters` (NPC generator + chat),
  `Timeline` (Time-Shift Mode), `Settings`. All in `src/screens/`.

### Known-good as of now — don't re-break this

`ibm/granite-3-8b-instruct` was deprecated by IBM and was causing
"model not found" errors throughout the app (character chat, world Q&A,
consistency audit — anywhere `generate()` was called). It's been replaced
with `ibm/granite-3-3-8b-instruct` in `MODEL_CHAIN` in `src/lib/watsonx.js`,
and a `listAvailableModels()` diagnostic was added that queries
`/wx/ml/v1/foundation_model_specs` and surfaces the project's actually-
available models if both configured models fail (wired into
`pingService()`, shown via Settings → Test connection). If you see model
errors again, IBM has deprecated another model ID — use that diagnostic to
find the current one rather than guessing, and update `MODEL_CHAIN`.

## Architecture decision already made — do not re-litigate this

The proposal (section 9.4, section 10) names LangChain/LangFlow and a real
vector database (Chroma) as the retrieval layer. **Given the deadline, do
NOT stand up LangChain, a vector database, or a separate orchestration
framework.** Instead:

- Keep and port `src/lib/retrieval.js`'s term-overlap relevance scoring
  as the retrieval layer, moved server-side.
- Update the submission README to describe this honestly as "a lightweight
  custom relevance-ranking retrieval layer" rather than claiming
  LangChain/LangFlow were used. Do not describe a technology in the
  submission that isn't actually in the code.

This is a deliberate scope cut to protect the deadline, not a placeholder to
revisit later. If time remains after Tier 1–3 below are solid, a real
vector store can be considered, but it is explicitly Tier 4/optional.

## Build tiers, in priority order (stop and ship if you run out of time)

### Tier 1 — Real backend + data store (do this first, everything else depends on it)

1. Add a backend (FastAPI, matching the proposal's stated stack) with
   endpoints for: create/list/search canon assets, generate (gap-fill,
   character, era-shift, consistency-audit, ask), and world CRUD.
2. Add SQLite for structured data: worlds, assets (lore/character/
   location/faction/event), with columns for the existing fields
   (title, type, era, faction, mood, content, createdAt) plus an id and
   worldId foreign key.
3. Move `src/lib/watsonx.js`'s IAM token exchange and generation calls to
   the backend. The API key must never ship in a browser bundle again —
   right now `VITE_WATSONX_API_KEY` is embedded client-side via Vite env
   vars, which is fine for a local POC but wrong for anything else. The
   frontend should call your backend; your backend holds the credential.
4. Move `retrieval.js`'s scoring logic server-side, run it against the
   SQLite-stored assets before every generation call, same behavior as now.
5. **Definition of done:** every screen still works exactly as it does now,
   but state persists in SQLite instead of `localStorage`, and the API key
   is no longer visible in browser dev tools/network tab.

### Tier 2 — Auto-tagging as a real pipeline step

Right now tagging (type/era/faction/mood) is requested from the model in
the same JSON call that generates the content — there's no separate
classification step. Split it: after content generation succeeds, run a
second lightweight classification call (or a cheaper rule-based pass if
you want to save on model calls) that assigns tags independently, matching
the proposal's "auto-tagging layer runs on every generated asset
immediately after creation" (section 9.5). Store tags alongside the asset
in SQLite in a way that supports the existing search/filter UI in
`WorldBook.jsx` without changing its component contract.

### Tier 3 — Consistency audit and grounding transparency

Keep the existing consistency-audit feature (`WorldBook.jsx`) and the
"grounding context" panel (`Create.jsx` shows which entries were retrieved
before generating) — both already demonstrate the proposal's "creative
partner, not content vending machine" pitch. Just make sure they still work
once retrieval and storage move server-side.

### Tier 4 — Optional, only if Tier 1–3 are solid with time to spare

- A real vector store (Chroma) alongside the relevance scorer, if you want
  to more closely match the original proposal wording. Not required.
- Expand the Voice module (`src/lib/voice.js`) beyond browser TTS — only
  if there's genuine time left. This is explicitly the lowest-priority item
  in the proposal itself (section 9.7, "stretch goal").

## Non-negotiables

- IBM Granite via watsonx.ai stays the only LLM backend — do not substitute
  another provider.
- Every generation prompt must still include retrieved canon as grounding
  context — this is the core "creative partner, not generic generator"
  claim in the proposal and the pitch of the whole project. Don't let a
  refactor accidentally drop it.
- Keep the existing screens, navigation, and design system
  (`src/styles/global.css`) unless you find a concrete usability bug.
- Update `AGENTS.md` / `.bob/rules/` with any of these decisions once
  locked in, so they're enforced automatically in future tasks rather than
  re-explained each time.

## Suggested Bob workflow for this brief

1. `/init` (if not already run).
2. `/speckit.constitution` — lock in: SQLite for structured data, custom
   retrieval (no LangChain), watsonx credentials server-side only, Granite
   as the only LLM backend.
3. `/speckit.specify` against Tier 1 first — don't try to spec all four
   tiers at once.
4. `/speckit.plan`, then `/speckit.tasks`, then implement Tier 1 fully
   before moving to Tier 2.
5. After Tier 1 ships, repeat specify → plan → tasks for Tier 2, then Tier 3.
