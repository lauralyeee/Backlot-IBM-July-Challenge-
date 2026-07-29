/* ============================================================
   Backend API client — replaces direct localStorage + watsonx browser calls.
   All calls go to /api/* which is proxied to the FastAPI backend by Vite.
   The API key is held exclusively server-side.
   ============================================================ */

const BASE = "/api";

async function req(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ── World ──────────────────────────────────────────────────────────────────

export const createWorld = (data) => req("POST", "/worlds", data);
export const getWorld = (id) => req("GET", `/worlds/${id}`);
export const patchWorld = (id, data) => req("PATCH", `/worlds/${id}`, data);

// ── Assets ─────────────────────────────────────────────────────────────────

export const listAssets = (worldId, type) =>
  req("GET", `/worlds/${worldId}/assets${type ? `?type=${type}` : ""}`);

export const saveAsset = (worldId, asset) =>
  req("POST", `/worlds/${worldId}/assets`, asset);

export const deleteAsset = (worldId, assetId) =>
  req("DELETE", `/worlds/${worldId}/assets/${assetId}`);

export const updateAsset = (worldId, assetId, data) =>
  req("PATCH", `/worlds/${worldId}/assets/${assetId}`, data);

/**
 * Draft (or re-draft — it also rolls a new seed, i.e. "repaint") the visual
 * portrait prompt for an asset via Granite, persisted on the asset row.
 * The actual image render happens client-side via src/lib/portrait.js.
 * @returns {{ asset, offline? }}
 */
export const generatePortrait = (worldId, assetId) =>
  req("POST", `/worlds/${worldId}/assets/${assetId}/portrait`);

// ── AI-cast character voice (Gemini TTS) ────────────────────────────────────

/**
 * Draft a voice description via Granite, then pick a matching fixed
 * Gemini TTS voice and get one preview clip. Nothing is saved yet —
 * call again for a fresh take (regenerate), or confirmCharacterVoice()
 * once the preview sounds right.
 * @param {string} worldId
 * @param {number} assetId
 * @param {string[]} [excludeVoiceIds]  voices already shown this casting
 *   session — passed back so regenerate doesn't repeat the same voice.
 * @returns {{ voiceDescription, voiceId, voiceName, audioBase64, offline? }}
 */
export const designCharacterVoice = (worldId, assetId, excludeVoiceIds = []) =>
  req("POST", `/worlds/${worldId}/assets/${assetId}/voice/design`, { excludeVoiceIds });

/**
 * Lock in a previewed library voice as this character's permanent voice —
 * every future reply for them reuses it from here on.
 * @returns {{ asset }}
 */
export const confirmCharacterVoice = (worldId, assetId, voiceId, voiceDescription) =>
  req("POST", `/worlds/${worldId}/assets/${assetId}/voice/confirm`, {
    voiceId,
    voiceDescription,
  });

/**
 * Synthesize `text` in a character's already-cast voice. Returns a
 * playable object URL, or throws if no voice is cast yet / the service is
 * unavailable — callers should catch and fall back to Web Speech (see
 * src/lib/voice.js speak()).
 * @param {string} worldId
 * @param {number} assetId
 * @param {string} text
 * @returns {Promise<string>} an object URL for an <audio> element
 */
export async function speakAsCharacter(worldId, assetId, text) {
  const res = await fetch(`${BASE}/worlds/${worldId}/assets/${assetId}/voice/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API POST voice/speak → ${res.status}: ${detail}`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ── Concept media: 3D model, image, or video (manual upload + Blender/CharMorph generation) ──

/**
 * Manual import: upload a pre-made 3D model (.glb/.gltf), a concept-art
 * image, or a short video as an asset's concept media. The backend
 * classifies which kind it is by file extension and returns it as
 * asset.modelKind ("3d" | "image" | "video").
 * @param {string} worldId
 * @param {number} assetId
 * @param {File} file
 * @returns {{ asset }}
 */
export async function uploadModel3D(worldId, assetId, file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${BASE}/worlds/${worldId}/assets/${assetId}/model3d/upload`, { method: "POST", body: formData });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST /worlds/${worldId}/assets/${assetId}/model3d/upload → ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Kick off Blender/CharMorph 3D concept generation for a character asset.
 * Returns immediately with the asset in model_status "pending" — poll
 * getModel3DStatus() until it flips to "ready" or "failed".
 * @param {string} worldId
 * @param {number} assetId
 * @returns {{ asset }}
 */
export const generateModel3D = (worldId, assetId) =>
  req("POST", `/worlds/${worldId}/assets/${assetId}/model3d/generate`);

/**
 * @param {string} worldId
 * @param {number} assetId
 * @returns {{ asset }}
 */
export const getModel3DStatus = (worldId, assetId) =>
  req("GET", `/worlds/${worldId}/assets/${assetId}/model3d/status`);

/**
 * Remove an asset's 3D concept model (deletes the file on disk and clears
 * the model_* fields). Use this instead of deleting the .glb by hand --
 * the app has no way to notice a file that disappeared outside of it.
 * @param {string} worldId
 * @param {number} assetId
 * @returns {{ asset }}
 */
export const deleteModel3D = (worldId, assetId) =>
  req("DELETE", `/worlds/${worldId}/assets/${assetId}/model3d`);

// ── Export (Feature 2: assets → Markdown document) ─────────────────────────

/**
 * Read-only: compiles a filtered set of canon assets into a Markdown document.
 * Named exportDocument (not "export") because `export` is a reserved word in
 * JS modules.
 * @param {string} worldId
 * @param {{ docType: string, era?: string, faction?: string }} opts
 * @returns {{ markdown, docType, assetCount, generatedAt?, empty?, offline? }}
 */
export const exportDocument = (worldId, { docType, era = "", faction = "" }) =>
  req("POST", `/worlds/${worldId}/export`, { docType, era, faction });

// ── Ingestion (Feature 1: script/doc → auto-breakdown) ──────────────────────

/**
 * Read-only: extracts and diffs, but writes nothing. Approve entries with
 * commitIngested() below to actually add them to the World Book.
 * @param {string} worldId
 * @param {{text: string, title?: string}} doc
 * @returns {{ document, proposed, matches, timelineMarkers, relationships, offline? }}
 */
export const ingestText = (worldId, doc) =>
  req("POST", `/worlds/${worldId}/ingest`, { text: doc.text, title: doc.title || "Untitled document" });

/**
 * Docling companion to ingestText: same read-only staging, but the source
 * text comes from an uploaded PDF/DOCX file instead of pasted text. Uses
 * FormData directly (not the shared req() helper, which always JSON-encodes)
 * so the browser sets the correct multipart boundary itself.
 * @param {string} worldId
 * @param {File} file
 * @param {string} [title]
 * @returns {{ document, proposed, matches, timelineMarkers, relationships, offline? }}
 */
export async function ingestFile(worldId, file, title) {
  const formData = new FormData();
  formData.append("file", file);
  if (title) formData.append("title", title);
  const res = await fetch(`${BASE}/worlds/${worldId}/ingest/file`, { method: "POST", body: formData });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST /worlds/${worldId}/ingest/file → ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * @param {string} worldId
 * @param {object} document  the staged document object returned by ingestText
 * @param {Array}  assets    one or more approved entries to persist
 * @returns {{ created: Array }}
 */
export const commitIngested = (worldId, document, assets) =>
  req("POST", `/worlds/${worldId}/ingest/commit`, { document, assets });

/**
 * Overwrite an existing World Book asset with content from a matched extraction.
 * @param {string} worldId
 * @param {number} assetId   the id of the existing asset to overwrite
 * @param {object} document  the staged document object returned by ingestText
 * @param {object} item      the extracted item from staged.matches[n].extracted
 * @returns {{ updated: object }}
 */
export const updateIngestedAsset = (worldId, assetId, document, item) =>
  req("POST", `/worlds/${worldId}/ingest/update/${assetId}`, { document, item });

// ── Generation ─────────────────────────────────────────────────────────────

/**
 * @param {string} worldId
 * @param {"expand"|"character"|"era_shift"} mode
 * @param {object} opts  { fragment, era, subjectId, forceType, traits }
 *   traits (character mode only): optional { gender, age, appearance,
 *   personality } — provided keys become hard requirements; blank = AI invents.
 * @returns {{ asset, grounding, offline?, error? }}
 */
export const generateAsset = (worldId, mode, opts = {}) =>
  req("POST", `/worlds/${worldId}/generate`, {
    mode,
    fragment: opts.fragment || "",
    era: opts.era || "",
    subject_id: opts.subjectId || null,
    force_type: opts.forceType || null,
    traits: opts.traits || null,
  });

// ── Custom persona generation ──────────────────────────────────────────────

/**
 * @param {string} description  Free-text world description from the user
 * @param {string[]|null} [customEras]  Writer-specified era names, if any --
 *   these always win over whatever the model would invent.
 * @returns {{ personaLabel, eras, nameIdeas, seed, offline? }}
 */
export const generateCustomPersona = (description, customEras) =>
  req("POST", "/personas/custom", {
    description,
    ...(customEras && customEras.length ? { customEras } : {}),
  });

// ── Eras (Timeline / Time-Shift Mode) ───────────────────────────────────────

/**
 * Rename an era; the backend cascades the change to every asset tagged with
 * the old era name so a rename never silently orphans existing entries.
 * @returns {{ world, assetsUpdated }}
 */
export const renameEra = (worldId, oldEra, newEra) =>
  req("POST", `/worlds/${worldId}/eras/rename`, { oldEra, newEra });

/**
 * Remove an era. If entries still use it, pass mergeInto (one of the
 * world's other eras) to reassign them first -- otherwise the backend
 * responds with a 409 and a count so the caller can prompt for a target.
 * @returns {{ world, assetsReassigned }}
 */
export const removeEra = (worldId, era, mergeInto) =>
  req("POST", `/worlds/${worldId}/eras/remove`, {
    era,
    ...(mergeInto ? { mergeInto } : {}),
  });

/**
 * AI-draft 1-2 sentence descriptions for eras that lack one (or pass a
 * specific era name to re-draft just that one). Descriptions feed the
 * era-shift prompt and portrait briefs, so the model knows what each era
 * means instead of guessing from its name.
 * @returns {{ world, described: string[], offline? }}
 */
export const describeEras = (worldId, era) =>
  req("POST", `/worlds/${worldId}/eras/describe`, era ? { era } : {});


// ── Consistency audit ──────────────────────────────────────────────────────

export const auditWorld = (worldId) => req("POST", `/worlds/${worldId}/audit`, {});

// ── Ask / Q&A ──────────────────────────────────────────────────────────────

/**
 * @param {string} worldId
 * @param {"lore"|string} mode  "lore" or character asset id
 * @param {string} question
 * @param {Array}  history   [{role, text}, …]
 * @returns {{ reply, offline? }}
 */
export const ask = (worldId, mode, question, history = []) =>
  req("POST", `/worlds/${worldId}/ask`, { mode, question, history });

// ── Diagnostics ────────────────────────────────────────────────────────────

export const pingBackend = () => req("GET", "/ping");
export const listModels = () => req("GET", "/models");
